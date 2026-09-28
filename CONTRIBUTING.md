# Contributing to Assup

Thanks for your interest! Bug reports, feature ideas and pull requests are all welcome.

## Before you start

- **Bugs:** open an issue with steps to reproduce, what you expected, and what happened. Include relevant backend logs and your TWS / IB Gateway version. **Never paste account numbers, positions, FLEX reports or API keys.** Redact or replace them with made-up values.
- **Features:** for anything larger than a small fix, open an issue first so we can agree on the approach before you invest time.

## Development setup

Follow [Run locally](README.md#run-locally) in the README. A paper-trading TWS account is strongly recommended for development.

```bash
npm install          # all workspaces; also builds packages/shared
```

### Tests

Backend tests use [Vitest](https://vitest.dev). Some are integration tests that **delete rows** from the database they connect to. Always run them against a dedicated test database:

```bash
docker compose exec postgres createdb -U assup assup_test   # once
cd backend
export DATABASE_URL="postgresql://assup:assup_dev@localhost:5432/assup_test"
npx prisma migrate deploy
npm run test:run
```

Frontend:

```bash
npm run lint --workspace=frontend
npm run build --workspace=frontend
```

## Coding guidelines

- **TypeScript everywhere.** Types shared between backend and frontend live in `packages/shared`.
- **Match the surrounding code:** naming, comment density, file layout.
- **Fail fast and loud.** Never silently skip invalid data, never guess missing values, and never fall back to defaults for critical fields such as dates, prices or quantities. Throw instead.
- **Error messages must be actionable:** include the invalid value, list the expected formats, and say how to fix it (for example, "Reconfigure your FLEX Query to include the TradeDate field").
- **Data imports** validate all required columns before processing any record, and stop at the first invalid record.
- Keep IBKR market-data line usage in mind: TWS allows about 100 concurrent lines, and streams share a reservation budget.

## Pull requests

1. Branch from `main`.
2. Keep each PR focused on one fix or feature, and add tests for behaviour changes.
3. Make sure tests, lint and build pass.
4. Use [Conventional Commits](https://www.conventionalcommits.org) style messages, e.g. `fix(spreads): …`, `feat(wheel): …`.
5. For UI changes, include a screenshot. Use fictional data only: [`scripts/screenshots`](scripts/screenshots) renders the app with a demo portfolio.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
