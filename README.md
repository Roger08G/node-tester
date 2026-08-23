# node-tester

`node-tester` es una CLI para ejecutar tests del runner nativo [`node:test`](https://nodejs.org/api/test.html) con un resultado más legible, timeouts seguros y salida acotada.

> Estado: desarrollo inicial (`0.1.0`). Todavía no está publicado ni se considera listo para producción.

## Alcance actual

- Node.js 22.10 o posterior.
- Runner nativo `node:test`.
- Aislamiento nativo por archivo mediante procesos, sin crear un proceso adicional por cada test.
- Eventos estructurados de `TestsStream`; no analiza la salida visual TAP o `spec`.
- Timeout por test de 30 segundos y timeout global de 15 minutos por defecto.
- Captura conjunta de `stdout` y `stderr` limitada a 64 KiB.
- Rutas del proyecto y del usuario saneadas en los errores mostrados.

Jest, Vitest, Mocha, Bun Test y harnesses personalizados todavía no están soportados. Se añadirán mediante adaptadores separados para no mezclar contratos incompatibles.

## Desarrollo

```bash
bun install
bun run build
node dist/cli.js test/fixtures/passing.test.mjs
```

Para ejecutar todas las comprobaciones:

```bash
bun run typecheck
bun run test
```

## Uso

```text
node-tester [rutas...] [opciones] [-- argumentos-del-test]
```

Ejemplos:

```bash
node dist/cli.js test/unit.test.mjs
node dist/cli.js --glob "test/**/*.test.mjs" --concurrency 4
node dist/cli.js test/api.test.mjs --name "creates a user" --test-timeout 10s
```

Opciones principales:

| Opción | Función |
| --- | --- |
| `--glob <patrón>` | Selecciona archivos con un glob; se puede repetir. |
| `--name <regex>` | Incluye tests por nombre. |
| `--skip <regex>` | Excluye tests por nombre. |
| `--concurrency <n>` | Limita los archivos ejecutados en paralelo. |
| `--isolation process\|none` | Selecciona el modelo de aislamiento de Node. |
| `--test-timeout <tiempo>` | Limita cada test (`ms`, `s` o `m`). |
| `--run-timeout <tiempo>` | Cancela la ejecución completa. |
| `--max-output-kb <n>` | Limita la captura total de salida. |
| `--show-output` | Muestra la salida capturada; está oculta por defecto. |

La CLI devuelve `0` si todo pasa, `1` si hay fallos, `2` ante uso inválido o error interno y `124` cuando vence el timeout global.

## Arquitectura

`node-tester` llama directamente a la API programática de `node:test`. Node conserva su aislamiento predeterminado por archivo y la herramienta consume eventos `test:pass`, `test:fail`, `test:stdout`, `test:stderr` y `test:summary`. Esto evita depender del texto mutable de los reporters incorporados.

La carpeta `rust/` es un experimento inicial sin integración con la CLI. El primer hito se mantiene en TypeScript para validar el contrato antes de decidir si un núcleo nativo aporta una mejora medible.

## Licencia

MIT. Consulta [LICENSE](LICENSE).
