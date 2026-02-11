-- Delete exchange rates for currencies other than USD and EUR
-- These were fetched from CNB but are not needed for tax documentation
DELETE FROM exchange_rates WHERE currency NOT IN ('USD', 'EUR');
