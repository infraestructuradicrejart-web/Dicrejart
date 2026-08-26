# Agente NAS de Dicrejart

Revisa la cola de evidencias pendientes en Firestore (`nasMigrationQueue`) y las sube al
NAS por la API local de DSM. Corre **dentro del propio NAS Synology** — QuickConnect no
sirve para esto (requiere un navegador real ejecutando su JavaScript de negociación),
por eso el agente vive en la misma red que el NAS y le habla por `http://localhost:5000`.

Es un script de "correr y terminar" (no queda corriendo de fondo) — se programa para
ejecutarse cada 5 minutos con el Programador de Tareas de DSM.

## Instalación (una sola vez)

1. **Centro de Paquetes** → instalar **Node.js** (ya confirmado disponible).

2. **Clave de cuenta de servicio de Firebase**: en la [consola de Firebase](https://console.firebase.google.com/)
   → ⚙️ Configuración del proyecto → pestaña "Cuentas de servicio" → botón
   "Generar nueva clave privada" → se descarga un `.json`. Da acceso total de
   administrador al proyecto — **nunca la compartas ni la subas a ningún repositorio**.
   Cópiala a esta misma carpeta con el nombre `service-account.json`.

3. Copia `.env.example` a `.env` y llena los valores reales (usuario/contraseña de la
   cuenta dedicada de Synology, la misma que se usó para los secretos de Firebase de
   `functions/` — esos secretos quedaron sin uso, no hace falta borrarlos).

4. Copia toda esta carpeta (`nas-agent/`) al NAS, por ejemplo a
   `/volume1/homes/admin/nas-agent/`.

5. Activa SSH temporalmente (Panel de Control → Terminal y SNMP) y, conectado por SSH al
   NAS:
   ```
   cd /volume1/homes/admin/nas-agent
   npm install
   ```
   Puedes volver a apagar SSH después si quieres.

6. **Panel de Control → Programador de Tareas → Crear → Tarea programada → Script
   definido por el usuario**:
   - Programación: cada 5 minutos.
   - Usuario: el mismo usuario dueño de la carpeta `nas-agent/`.
   - Script:
     ```
     cd /volume1/homes/admin/nas-agent && /usr/local/bin/node index.js >> agent.log 2>&1
     ```
     (ajusta la ruta de `node` si el Centro de Paquetes lo instaló en otro lado — se
     puede confirmar por SSH con `which node`).

## Verificar que funciona

Corre la tarea manualmente una vez desde el Programador de Tareas ("Ejecutar") y revisa
`agent.log` en la misma carpeta — debe decir "Sin trabajos pendientes." si no hay nada
en la cola, o "✓ Migrado al NAS: ..." por cada archivo que suba.
