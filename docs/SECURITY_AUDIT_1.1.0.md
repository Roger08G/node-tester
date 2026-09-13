# Auditoría de seguridad y calidad — 1.1.0

Fecha: 2026-09-13. Alcance: biblioteca Rust, binding Node-API, bridge `node:test`,
CLI TypeScript, dependencias, empaquetado, instalador y GitHub Actions.
Se han combinado inspección de código, revisión independiente y pruebas. No es
una certificación ni una garantía de ausencia de vulnerabilidades.

## Hallazgos corregidos

| Prioridad                        | Problema                                                                                           | Corrección y evidencia                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Alta                             | El parser podía reservar una línea ilimitada antes de comprobar su tamaño.                         | Lectura acotada antes de asignar, límite por línea/stream/eventos y regresión sin newline.                   |
| Alta                             | Stdin bloqueado o descendientes con tuberías heredadas podían eludir el timeout.                   | Escritor vigilado, limpieza del grupo tras salir el líder y esperas acotadas; fixtures específicos.          |
| Alta                             | Un bridge incompleto podía producir éxito; se perdían fallos de suites/hooks.                      | Handshake y resumen final obligatorios, validación de eventos y suites fallidas explícitas sin inflar tests. |
| Alta (dependencia de desarrollo) | `js-yaml` anterior a 4.3.2 era susceptible a denegación de servicio.                               | Actualización bloqueada a 4.3.2; `bun audit` limpio.                                                         |
| Media                            | Se almacenaban todos los eventos, incluida salida ya descartada por el presupuesto.                | Agregación incremental en Rust y corte de eventos de salida descartados en el bridge.                        |
| Media                            | Nombres, errores y salida podían inyectar controles de terminal o filtrar rutas de otras unidades. | Saneamiento central y pruebas de reportes Windows.                                                           |
| Media                            | Validación inconsistente en CLI/API y archivos duplicados/inexistentes.                            | Límites comunes, rutas canónicas y error de uso antes del lanzamiento.                                       |
| Media                            | Repetir Ctrl-C podía terminar el host antes de limpiar procesos Unix.                              | Cancelación idempotente hasta terminar la limpieza acotada.                                                  |
| Media                            | Un reintento podía confundir otra copia de la misma versión con el tarball publicado.              | Comparación SHA-512 con npm y SHA-256 con GitHub; nunca se reemplazan bytes distintos.                       |

Aviso primario de la dependencia:
[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
Solo afecta a herramientas de desarrollo; el paquete publicado no incluye esas
dependencias. Los tests de seguridad usan datos sintéticos, no credenciales.

## Validación reproducible

- 15 pruebas Rust y 30 pruebas JavaScript con Node 24.18.1.
- Las mismas 30 pruebas con Node 22.13.0, incluida ejecución real del bridge.
- Formato, TypeScript estricto, Clippy con `-D warnings`, build release y smoke
  del tarball extraído fuera del repositorio.
- `bun audit` y RustSec: sin avisos conocidos en la comprobación de esta fecha
  (49 dependencias Rust bloqueadas).
- CI con seis plataformas nativas, Node 22.13/24, MSRV Rust 1.88, verificación
  de todos los binarios ensamblados e instalación/desinstalación del `.exe`.

Los jobs definitivos y la publicación pueden comprobarse en
[GitHub Actions](https://github.com/Roger08G/node-tester/actions/workflows/ci.yml).
Las pruebas locales no sustituyen la verificación del tag y sus assets remotos.

## Rendimiento observado

Windows x64, Node 24.18.1, addon release, cinco iteraciones alternadas de 500
tests: mediana de `node --test` 206,90 ms; Node Tester 331,47 ms; ratio 1,602
(60,2 % de sobrecarga). Reproducir con `bun run benchmark -- 5`.
La agregación evita retener otra colección completa de eventos; no demuestra
que la herramienta sea más rápida que Node. No se midió RSS pico.

## Contrato y límites

- Node ejecuta JavaScript; Rust controla y agrega la ejecución. Solo `node:test`,
  no Jest/Vitest/Mocha, watch ni cobertura.
- Captura predeterminada de 64 KiB, máximo 64 MiB; protocolo separado de hasta
  128 KiB por línea, 128 MiB totales y un millón de eventos; entrada de 1 MiB.
- La profundidad recibida está limitada a 128 y la sangría visible a 32.
- Tests y ejecutables tienen permisos del usuario. No hay sandbox, cota global
  de RAM del test ni garantía frente a procesos que abandonen su grupo.
- El saneamiento de rutas/controles no detecta cualquier secreto. `--show-output`
  puede mostrar datos privados; no debe usarse para publicar logs sin revisión.
- El `.exe` usa un Node.js x64/ARM64 existente; no lo descarga ni lo instala.
  No tiene firma Authenticode. El checksum comprueba integridad, no identidad.
- Las credenciales npm se administran fuera del repositorio. Un token compartido
  en una conversación debe revocarse; nunca debe incorporarse a código ni logs.
