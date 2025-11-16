# Guía de Diagnóstico - ZK Anonymous Poll

## Problemas Identificados y Soluciones

### 1. Base de Datos No Guarda Registros

**Problema**: Las propuestas no se están guardando en IndexedDB.

**Causas posibles**:
- El `pollId` no se está extrayendo correctamente de los eventos del contrato
- Errores silenciosos en IndexedDB
- El evento `PollCreated` no se está decodificando correctamente

**Soluciones implementadas**:
1. ✅ Mejorada la extracción del `pollId` de eventos con múltiples fallbacks
2. ✅ Agregado logging detallado en `savePollMetadata()` para identificar errores
3. ✅ Agregada función `debugDatabase()` para verificar el estado de la BD

**Cómo verificar**:
- Abre la consola del navegador (F12)
- Después de crear una propuesta, ejecuta: `debugPollDatabase()`
- Revisa los logs en la consola para ver si hay errores

### 2. Extracción del pollId de Eventos

**Problema**: El `pollId` no se extrae correctamente de los eventos del contrato Ink!

**Solución implementada**:
- Múltiples métodos de extracción:
  1. Decodificación usando el ABI del contrato
  2. Extracción de topics del evento (el segundo topic es el poll_id)
  3. Fallback: consultar `getTotalPolls()` después de la transacción

**Nota**: El método de `getTotalPolls()` es menos confiable si hay múltiples transacciones simultáneas.

### 3. Verificación del Contrato y Nodo

**Script de diagnóstico creado**: `scripts/diagnose-contract.js`

**Uso**:
```bash
cd /home/edgar/zkp-voting/zk-anonymous-poll
node scripts/diagnose-contract.js
```

**Qué verifica**:
- ✅ Conexión al nodo ink-node
- ✅ Estado del nodo (cadena, versión, bloque actual)
- ✅ Carga del ABI del contrato
- ✅ Métodos disponibles del contrato
- ✅ Estado del contrato (owner, total de polls, polls existentes)
- ✅ Dirección del verifier

## Pasos para Diagnosticar

### Paso 1: Verificar que el nodo esté corriendo

```bash
# Verificar si el nodo está corriendo
ps aux | grep ink-node

# Si no está corriendo, iniciarlo:
cd ink-node
./ink-node --dev --tmp
```

### Paso 2: Ejecutar script de diagnóstico

```bash
node scripts/diagnose-contract.js
```

Esto mostrará:
- Si el nodo está accesible
- El estado actual del contrato
- Cuántos polls existen
- Detalles de cada poll

### Paso 3: Verificar en el navegador

1. Abre la aplicación en el navegador
2. Abre la consola del desarrollador (F12)
3. Intenta crear una propuesta
4. Revisa los logs en la consola:
   - Busca mensajes que empiecen con `💾`, `✅`, `❌`, `⚠️`
   - Verifica si el `pollId` se extrae correctamente
   - Verifica si hay errores al guardar en IndexedDB

5. Después de crear una propuesta, ejecuta en la consola:
```javascript
debugPollDatabase()
```

Esto mostrará:
- El estado de la base de datos
- Cuántos polls hay guardados
- Detalles de cada poll

### Paso 4: Verificar eventos del contrato

Si el `pollId` sigue siendo 0, los eventos pueden no estar siendo emitidos correctamente. Revisa:

1. En la consola del navegador, busca los logs que muestran:
   - `📋 Eventos de la transacción:`
   - `📨 Evento completo:`
   - `📋 Estructura del evento:`

2. Verifica que haya eventos con `section: 'contracts'` y `method: 'ContractEmitted'`

3. Si no hay eventos, puede ser que:
   - El contrato no esté desplegado correctamente
   - La transacción falló silenciosamente
   - El nodo no está procesando eventos correctamente

## Comandos Útiles

### Verificar estado del contrato desde la línea de comandos

```bash
cd contracts

# Obtener total de polls
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message get_total_polls \
  --suri //Alice \
  --url ws://localhost:9944 \
  --skip-confirm

# Obtener detalles de un poll específico
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message get_poll \
  --args 1 \
  --suri //Alice \
  --url ws://localhost:9944 \
  --skip-confirm
```

### Limpiar la base de datos IndexedDB (si es necesario)

En la consola del navegador:
```javascript
// Eliminar la base de datos
indexedDB.deleteDatabase('zk-anonymous-poll-db')
// Recargar la página
location.reload()
```

## Próximos Pasos

1. **Si el nodo no está corriendo**: Iniciarlo con `./ink-node --dev --tmp`
2. **Si el contrato no está desplegado**: Revisar `DEPLOYMENT_INFO.md` y desplegar nuevamente
3. **Si los eventos no se emiten**: Verificar que el contrato esté desplegado en la dirección correcta
4. **Si la BD no guarda**: Revisar los logs en la consola para identificar el error específico

## Logging Mejorado

Se agregó logging detallado en:
- `CreatePoll.tsx`: Logs de eventos y extracción de pollId
- `database.ts`: Logs de operaciones de IndexedDB
- `App.tsx`: Función de debug disponible en la consola

Todos los logs usan emojis para facilitar la identificación:
- 💾 = Operaciones de base de datos
- ✅ = Operación exitosa
- ❌ = Error
- ⚠️ = Advertencia
- 🔍 = Búsqueda/Diagnóstico
- 📋 = Información/Eventos
- 📊 = Datos


