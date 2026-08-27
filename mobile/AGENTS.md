# OhMyCode Mobile Instructions

## Scope

- This file applies to `mobile/`.
- Follow the repository root `AGENTS.md` first; these rules specialize it for Expo.

## Architecture

- Keep Expo Router route files thin. Feature state and UI belong under `src/features/`.
- Native API, SecureStore, transport, and device behavior belong under `src/shared/` adapters.
- Consume shared protocols, Runtime contracts, and design tokens from `packages/`.
- Do not copy Electron IPC, Node APIs, terminal tools, filesystem tools, or attachment analysis into mobile.
- Mobile capabilities must be explicitly implemented and must fail closed when unavailable.

## UI

- Use `@ohmycode/design-tokens`; do not scatter theme colors or spacing literals.
- Component-specific React Native styles live beside the component in `*.styles.ts`.
- All visible text must use react-i18next keys.
- Support light and dark themes, safe areas, keyboard avoidance, and accessible press targets.

## Validation

```bash
pnpm --filter @ohmycode/mobile typecheck
pnpm --filter @ohmycode/mobile lint
pnpm --filter @ohmycode/mobile exec expo install --check
```
