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

Los límites de stdout/stderr se aplican durante la lectura; los resultados de
tests también tienen límites defensivos de protocolo. Al superar el límite de
protocolo o recibir datos incompletos, la ejecución falla de forma explícita.
Los procesos que se desvinculen deliberadamente del grupo de ejecución quedan
fuera del contrato; el runner no limita toda la memoria de los propios tests.

Las trazas mostradas sustituyen rutas del proyecto y del directorio personal y
neutralizan controles de terminal. Esto no identifica secretos arbitrarios ni
convierte `--show-output` en un modo seguro para publicar logs privados.

El release verifica el SHA-512 del tarball npm y publica checksums SHA-256 para
los assets de GitHub. Los instaladores no tienen firma Authenticode. Un checksum
comprueba integridad pero no sustituye la firma del editor. Las auditorías de
dependencias solo cubren avisos conocidos en la fecha de la comprobación.
