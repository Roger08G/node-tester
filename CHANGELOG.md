# Changelog

Los cambios relevantes de este proyecto se documentan aquí siguiendo versionado semántico.

## 1.1.0 - 2026-09-13

### Seguridad y correcciones

- Lectura incremental del protocolo Rust con límites aplicados antes de reservar líneas; se elimina la copia completa de eventos intermedios.
- El timeout global cubre la escritura de configuración y la salida del bridge. Se limpian descendientes y tuberías incluso cuando sale el proceso principal.
- Se rechazan protocolos incompletos y resultados incoherentes; los fallos de suites/hooks y tests cancelados no producen falsos éxitos.
- Validación de rutas, límites de argumentos, duraciones y configuración antes de lanzar tests.
- Saneamiento de controles de terminal y rutas externas de Windows en los reportes.
- Actualizadas las dependencias bloqueadas, incluido `js-yaml` 4.3.2 para corregir GHSA-2883-xcg3-v3hh en herramientas de desarrollo.

### Distribución y validación

- Instalador Windows por usuario para Node.js 22.13 o posterior, con PATH opcional y desinstalación que conserva entradas ajenas.
- Versiones npm y Rust alineadas en 1.1.0; seis binarios nativos, tarball npm, instalador, fuentes y checksums.
- CI con MSRV Rust 1.88, pruebas de Node.js 22.13/24, paquete instalado, instalador y límites de duración por job.
- Verificación del SHA-512 publicado en npm y del SHA-256 de los assets de GitHub, sin sobrescribir archivos publicados diferentes.
- Nuevos fixtures de regresión y benchmark con orden alternado, timeout y salida acotada.
- README, SECURITY y CONTRIBUTING alineados con el contrato y sus límites reales.

## 1.0.1 - 2026-08-23

### Cambiado

- Actualizado el banner visual del proyecto en `assets/test.png`.
- Eliminado el recurso SVG anterior que ya no se utiliza.

## 1.0.0 - 2026-08-23

### Añadido

- Motor de ejecución `node-tester-engine` escrito como biblioteca Rust.
- Binding Node-API asíncrono para la CLI TypeScript.
- Ejecución de `node:test` con aislamiento nativo por archivo.
- Timeouts por test y global, cancelación por señal y terminación del árbol de procesos.
- Protocolo JSON versionado con límites de tamaño y número de eventos.
- Captura acotada de salida y saneamiento de rutas privadas.
- Compatibilidad ESM/CommonJS, filtros, globs, concurrencia y argumentos Node/test.
- Binarios para Windows, Linux GNU y macOS en x64/ARM64.
- CI multi-plataforma, publicación npm con procedencia y release verificable.
- Fixtures end-to-end y benchmark comparativo frente a `node --test`.
