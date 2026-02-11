/**
 * Service for fetching and caching CNB (Czech National Bank) exchange rates
 * Used for tax calculations requiring CZK conversion
 */

import { prisma } from "../db/index.js";
import { Prisma } from "@prisma/client";

interface CnbRate {
  currency: string;
  amount: number;
  rate: number;
}

/** Only these currencies are needed for tax documentation */
const ALLOWED_CURRENCIES = ["USD", "EUR"];

class CnbExchangeRateService {
  private readonly CNB_URL =
    "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt";

  /**
   * Fetch rates from CNB for a specific date
   */
  async fetchRatesFromCnb(date: Date): Promise<CnbRate[]> {
    const formattedDate = this.formatDateForCnb(date);
    const url = `${this.CNB_URL}?date=${formattedDate}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CNB API error: ${response.status}`);
    }

    const text = await response.text();
    return this.parseCnbResponse(text, date);
  }

  /**
   * Parse CNB text response into rates
   * Format:
   * 22.01.2026 #16
   * země|měna|množství|kód|kurz
   * Austrálie|dolar|1|AUD|14,532
   */
  private parseCnbResponse(text: string, requestedDate: Date): CnbRate[] {
    const lines = text.trim().split("\n");
    const rates: CnbRate[] = [];

    // Skip header lines (date and column headers)
    for (let i = 2; i < lines.length; i++) {
      const parts = lines[i].split("|");
      if (parts.length >= 5) {
        const amount = parseInt(parts[2], 10);
        const currency = parts[3];
        const rate = parseFloat(parts[4].replace(",", "."));

        if (!isNaN(amount) && !isNaN(rate) && currency) {
          rates.push({
            currency,
            amount,
            rate: rate / amount, // Normalize to rate per 1 unit
          });
        }
      }
    }

    // Cache all fetched rates
    if (rates.length > 0) {
      this.cacheRates(requestedDate, rates).catch((err) => {
        console.error("Failed to cache rates:", err);
      });
    }

    return rates;
  }

  private formatDateForCnb(date: Date): string {
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  /**
   * Get rate for a specific date and currency
   * Fetches from CNB if not cached
   */
  async getRate(
    date: Date,
    currency: string,
    maxRetries = 7
  ): Promise<number | null> {
    // Normalize date to start of day in UTC
    const normalizedDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );

    // Check cache first
    const cached = await prisma.exchangeRate.findUnique({
      where: {
        date_currency: {
          date: normalizedDate,
          currency,
        },
      },
    });

    if (cached) {
      return cached.rate.toNumber();
    }

    // Fetch from CNB
    try {
      const rates = await this.fetchRatesFromCnb(normalizedDate);
      const targetRate = rates.find((r) => r.currency === currency);

      if (targetRate) {
        return targetRate.rate;
      }
    } catch {
      // CNB might not have rates for this date (weekend/holiday)
    }

    // Try previous day (for weekends/holidays)
    if (maxRetries > 0) {
      const prevDay = new Date(normalizedDate);
      prevDay.setDate(prevDay.getDate() - 1);
      return this.getRate(prevDay, currency, maxRetries - 1);
    }

    return null;
  }

  /**
   * Cache rates in database (only allowed currencies)
   */
  private async cacheRates(date: Date, rates: CnbRate[]): Promise<void> {
    const normalizedDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );

    const filteredRates = rates.filter((r) =>
      ALLOWED_CURRENCIES.includes(r.currency)
    );

    if (filteredRates.length === 0) return;

    const data = filteredRates.map((r) => ({
      date: normalizedDate,
      currency: r.currency,
      rate: new Prisma.Decimal(r.rate.toFixed(4)),
      source: "CNB",
    }));

    await prisma.exchangeRate.createMany({
      data,
      skipDuplicates: true,
    });
  }

  /**
   * Prefetch rates for an entire year
   */
  async prefetchRatesForYear(
    year: number,
    currencies: string[] = ALLOWED_CURRENCIES
  ): Promise<{ fetched: number; skipped: number }> {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));
    const today = new Date();
    const actualEndDate = endDate > today ? today : endDate;

    let fetched = 0;
    let skipped = 0;
    const currentDate = new Date(startDate);

    while (currentDate <= actualEndDate) {
      // Skip weekends
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        // Check if we already have rates for this date
        const existing = await prisma.exchangeRate.findFirst({
          where: {
            date: new Date(currentDate),
            currency: { in: currencies },
          },
        });

        if (!existing) {
          try {
            const rates = await this.fetchRatesFromCnb(new Date(currentDate));
            if (rates.length > 0) {
              fetched++;
            } else {
              skipped++;
            }
          } catch {
            // CNB might not have rates for holidays
            skipped++;
          }
          // Add small delay to avoid overwhelming CNB API
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          skipped++;
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return { fetched, skipped };
  }

  /**
   * Get all rates for a year (only allowed currencies)
   */
  async getRatesForYear(year: number): Promise<
    Array<{
      date: string;
      currency: string;
      rate: number;
    }>
  > {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));

    const rates = await prisma.exchangeRate.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
        currency: { in: ALLOWED_CURRENCIES },
      },
      orderBy: { date: "asc" },
    });

    return rates.map((r) => ({
      date: r.date.toISOString().split("T")[0],
      currency: r.currency,
      rate: r.rate.toNumber(),
    }));
  }

  /**
   * Get status of rates for a year (only allowed currencies)
   */
  async getStatusForYear(year: number): Promise<{
    year: number;
    totalTradingDays: number;
    loadedDays: number;
    missingDates: string[];
    currencies: string[];
  }> {
    const startDate = new Date(Date.UTC(year, 0, 1));
    const endDate = new Date(Date.UTC(year, 11, 31));
    const today = new Date();
    const actualEndDate = endDate > today ? today : endDate;

    // Count trading days (weekdays)
    let totalTradingDays = 0;
    const tradingDates: string[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= actualEndDate) {
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        totalTradingDays++;
        tradingDates.push(currentDate.toISOString().split("T")[0]);
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Get loaded dates (only for allowed currencies)
    const loadedRates = await prisma.exchangeRate.findMany({
      where: {
        date: {
          gte: startDate,
          lte: actualEndDate,
        },
        currency: { in: ALLOWED_CURRENCIES },
      },
      select: {
        date: true,
        currency: true,
      },
      distinct: ["date"],
    });

    const loadedDates = new Set(
      loadedRates.map((r) => r.date.toISOString().split("T")[0])
    );

    // Get unique currencies (only from allowed list that exist in DB)
    const allCurrencies = await prisma.exchangeRate.findMany({
      where: {
        date: {
          gte: startDate,
          lte: actualEndDate,
        },
        currency: { in: ALLOWED_CURRENCIES },
      },
      select: {
        currency: true,
      },
      distinct: ["currency"],
    });
    const currencies = allCurrencies.map((r) => r.currency);

    const missingDates = tradingDates.filter((d) => !loadedDates.has(d));

    return {
      year,
      totalTradingDays,
      loadedDays: loadedDates.size,
      missingDates,
      currencies,
    };
  }
}

export const cnbExchangeRateService = new CnbExchangeRateService();
