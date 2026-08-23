# Changelog

Los cambios relevantes de este proyecto se documentan aquí siguiendo versionado semántico.

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
