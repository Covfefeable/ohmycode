# OhMyCode Mobile

Expo / React Native mobile application for OhMyCode. It shares protocol,
runtime contracts, and design tokens with the desktop application, while native
storage, transport, and capabilities remain mobile adapters.

## Development

From the repository root:

```bash
pnpm install
pnpm --filter @ohmycode/mobile start
```

Development builds derive the API host from the Expo development server and use
port `8765`. Set `EXPO_PUBLIC_API_URL` to override it. The API must listen on
`0.0.0.0`; a physical device cannot reach a server bound to `127.0.0.1`.

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:8765 pnpm --filter @ohmycode/mobile start
```

## Boundaries

- No filesystem attachments or desktop command tools.
- Tokens are stored with Expo SecureStore.
- Screens use shared `@ohmycode/design-tokens` values.
- Platform adapters may depend on shared packages; shared packages never depend
  on Expo or application code.
