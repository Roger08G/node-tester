# Política de seguridad

## Versiones soportadas

La rama de producción `1.x` recibe correcciones de seguridad. Las versiones de desarrollo anteriores a `1.0.0` no están soportadas.

## Reporte privado

No publiques vulnerabilidades explotables en un issue. Utiliza **GitHub Security Advisories → Report a vulnerability** en `Roger08G/node-tester` e incluye:

- versión, sistema operativo y arquitectura;
- comando mínimo reproducible;
- impacto y condiciones necesarias;
- cualquier prueba que no contenga secretos ni datos de terceros.

Se confirmará la recepción y se coordinarán corrección, CVE y publicación antes de hacer públicos los detalles.

## Frontera de confianza

`node-tester` ejecuta los tests y los argumentos Node con los permisos del usuario. Los repositorios y tests deben considerarse código confiable. La herramienta protege sus procesos, protocolo y memoria, pero no intenta aislar código malicioso.

No adjuntes tokens, variables de entorno, rutas privadas completas ni salida sensible en un reporte público.
