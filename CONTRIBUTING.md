# Contribuir

## Preparación

Instala Node.js 24, Bun 1.3.14 y el toolchain fijado en `rust-toolchain.toml`.

```bash
bun install --frozen-lockfile
bun run build
```

## Comprobaciones obligatorias

```bash
bun run format:check
bun run check:rust
bun run typecheck
bun run test
npm pack --dry-run
```

Los cambios del protocolo requieren incrementar su versión tanto en `rust/engine` como en `runtime/node-test-bridge.mjs`, añadir pruebas de compatibilidad y documentar la migración.

No cambies el aislamiento por proceso ni añadas un parser de TAP/spec. Los nuevos runners deben usar adaptadores separados con un contrato y fixtures propios.

## Pull requests

- Mantén cada cambio limitado a un objetivo.
- Añade pruebas para éxito, fallo y cancelación.
- No incluyas binarios nativos, `dist/`, secretos o datos de proyectos privados.
- Explica cualquier cambio de compatibilidad o consumo de recursos.

## Publicación

Los binarios se generan exclusivamente en GitHub Actions; no publiques un paquete creado en una sola plataforma. La versión de `package.json` debe coincidir exactamente con el tag `v<versión>`.

Las versiones de `package.json` y del workspace Rust deben coincidir. La rama
de producción se llama `X.Y.Z` y el tag `vX.Y.Z`; no se mueven tags publicados.
La publicación usa `ci.yml` y el environment `npm`, con su secreto de Actions o
Trusted Publishing si está configurado en npm. Nunca guardes credenciales en el
repositorio. Verifica la identidad y el SHA-512 del paquete instalado desde npm,
los checksums de GitHub y el smoke test de instalación/desinstalación Windows.
