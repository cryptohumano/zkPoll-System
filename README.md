# 🗳️ ZK Anonymous Poll - Sistema de Votación Anónima para OpenGov

Sistema de votación anónima con Zero-Knowledge Proofs diseñado para **OpenGov (Governance Abierto)** que permite a ciudadanos de distintas regiones participar en decisiones democráticas de forma segura, anónima y verificable.

> **Nota:** Este proyecto está basado en el trabajo inicial de [@lynette7](https://github.com/lynette7). Agradecemos su contribución fundamental a la base del proyecto.

## 📋 Descripción

Este proyecto implementa un sistema de votación anónima que utiliza:
- **Ink! Smart Contracts** en Substrate/Polkadot para la lógica de votación
- **Noir** para circuitos Zero-Knowledge que garantizan anonimato y unicidad de votos
- **IndexedDB** para persistencia local de metadata de polls
- **Polkadot.js** para interacción con la blockchain

El sistema está pensado para ser utilizado en un contexto de **OpenGov**, donde ciudadanos de diferentes regiones pueden participar en decisiones democráticas sin revelar su identidad, pero garantizando que cada persona solo puede votar una vez.

## ✨ Estado Actual del Proyecto

### ✅ Funcionalidades Implementadas

- **✅ Compilación y despliegue del contrato Ink!**
  - Contrato compilado y desplegado en ink-node local
  - Dirección del contrato: `0x5801b439a678d9d3a68b8019da6a4abfa507de11`

- **✅ Frontend funcional**
  - Listado de polls desde el contrato
  - Creación de nuevas polls
  - Visualización de resultados en tiempo real
  - Sincronización automática con el contrato

- **✅ Sistema de cuentas**
  - Soporte para cuentas de desarrollo (//Alice, //Bob, etc.)
  - Integración con extensión Polkadot.js
  - Selección de cuentas desde la UI

- **✅ Base de datos local (IndexedDB)**
  - Persistencia de metadata de polls (título, descripción, opciones, duración)
  - Almacenamiento de votos locales
  - Sincronización bidireccional con el contrato

- **✅ Sistema de logging**
  - Logs centralizados con categorías (app, database, api, contract, chain)
  - Modal de logs para debugging
  - Funciones de diagnóstico expuestas en consola

- **✅ Manejo de múltiples redes**
  - Soporte para ink-node local, Paseo Testnet y Polkadot Mainnet
  - Validación de contratos deployados por red
  - Prevención de transacciones en redes sin contrato

### ⚠️ Funcionalidades Pendientes

- **❌ Primitivos de criptografía para firma con Polkadot.js**
  - Implementación completa de firmas criptográficas
  - Validación de firmas en el frontend
  - Integración con wallets externos

- **❌ Generación y verificación de pruebas ZK con Noir**
  - Integración del circuito Noir en el frontend
  - Generación de pruebas ZK al votar
  - Verificación de pruebas en el contrato

- **❌ Despliegue en redes públicas**
  - Deploy del contrato en Paseo Testnet
  - Deploy del contrato en Polkadot Mainnet
  - Configuración de direcciones por red

- **❌ Sistema de Merkle Tree completo**
  - Generación de Merkle Tree para lista de votantes elegibles
  - Verificación de pertenencia al árbol en el circuito ZK
  - Gestión de nullifiers para prevenir doble voto

- **❌ Integración con OpenGov**
  - Conectores con sistemas de governance de Polkadot
  - Mapeo de propuestas de OpenGov a polls
  - Notificaciones y actualizaciones automáticas

## 🚀 Inicio Rápido

### Prerrequisitos

Antes de comenzar, asegúrate de tener instalado:

1. **Rust** (última versión estable)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Node.js** 18+ y **Yarn** (usando corepack)
   ```bash
   # Node.js 18+ incluye corepack
   corepack enable
   ```

3. **cargo-contract** para compilar contratos Ink!
   ```bash
   cargo install cargo-contract --force --locked
   ```

4. **ink-node** (nodo local de Substrate para desarrollo)
   - Descarga desde: https://github.com/paritytech/ink/releases
   - O compila desde fuente si es necesario
   - Coloca el binario en la raíz del proyecto como `ink-node`
   - Dale permisos de ejecución: `chmod +x ink-node`

### Instalación

```bash
# 1. Clonar el repositorio
git clone git@github.com:cryptohumano/zkPoll-System.git
cd zkPoll-System

# 2. Instalar dependencias del frontend (usando corepack yarn)
cd frontend
corepack yarn install

# 3. Compilar el contrato Ink!
cd ../contracts
cargo contract build --release

# 4. Verificar que el ABI se generó correctamente
# El archivo debe estar en: frontend/public/contracts/target/ink/contracts.json
ls -la ../frontend/public/contracts/target/ink/contracts.json
```

### Ejecutar el Proyecto

#### 1. Iniciar ink-node

```bash
# Desde la raíz del proyecto
./ink-node --dev --tmp
```

El nodo estará disponible en `ws://localhost:9944`

#### 2. Desplegar el Contrato

```bash
cd contracts

# Desplegar el contrato (usa una dirección de verificador temporal)
cargo contract instantiate \
    --constructor new \
    --args "0x0000000000000000000000000000000000000001" \
    --suri //Alice \
    --url ws://localhost:9944 \
    --skip-confirm \
    --execute
```

**Nota:** Guarda la dirección del contrato desplegado. Actualiza `frontend/src/config.ts` con esta dirección:

```typescript
export const CONTRACT_ADDRESSES = {
  'ink-local': '0xTU_DIRECCION_AQUI',
  // ...
}
```

#### 3. Iniciar el Frontend

```bash
cd frontend
corepack yarn dev
```

El frontend estará disponible en `http://localhost:5173` (o el puerto que Vite asigne)

**Nota importante:** Asegúrate de que:
- El ink-node esté corriendo en otra terminal
- El contrato esté desplegado y la dirección actualizada en `frontend/src/config.ts`
- El ABI del contrato esté en `frontend/public/contracts/target/ink/contracts.json`

## 📖 Guía de Uso

### Crear una Poll

1. Asegúrate de tener una cuenta seleccionada (usa //Alice para desarrollo)
2. Haz clic en "**+ Crear Nueva Encuesta**"
3. Completa el formulario:
   - **Título**: Nombre de la encuesta
   - **Descripción**: Descripción detallada
   - **Número de opciones**: Cantidad de opciones de voto
   - **Nombres de opciones**: Etiquetas para cada opción
   - **Duración**: Tiempo en segundos (86400 = 1 día)
4. Haz clic en "**Crear Encuesta**"

La poll se creará en el contrato y se guardará en IndexedDB local.

### Votar en una Poll

1. Selecciona una poll de la lista
2. Haz clic en "**Votar**"
3. Selecciona tu opción
4. Haz clic en "**🗳️ Enviar Voto**"

**Nota:** Actualmente se usan pruebas ZK mock. En producción, se generarán pruebas ZK reales con Noir.

### Ver Resultados

Los resultados se actualizan automáticamente cada 5 segundos. Puedes ver:
- Total de votos por opción
- Porcentajes
- Tiempo restante de la poll

### Sincronizar Datos

Si los datos no se muestran correctamente:
1. Haz clic en el botón "**🔄 Sincronizar**" en el header
2. O desde la consola del navegador: `await syncAllPolls()`

### Funciones de Diagnóstico

Abre la consola del navegador (F12) y usa:

```javascript
// Diagnóstico completo
await diagnosePolls()

// Sincronizar todas las polls
await syncAllPolls()

// Obtener metadata de una poll específica
await getPollFromContract(1)

// Ver estado de la base de datos
debugPollDatabase()

// Ver logs del sistema
// Haz clic en el botón "📊 Logs" en el header
```

## 🔐 Cuentas de Sistema

El proyecto soporta dos tipos de cuentas:

### Cuentas de Desarrollo (Dev Accounts)

Cuentas predefinidas de Substrate para desarrollo local:
- `//Alice` - Cuenta principal de desarrollo
- `//Bob`, `//Charlie`, `//Dave`, `//Eve`, `//Ferdie`

Estas cuentas tienen fondos ilimitados en el nodo local y no requieren configuración adicional.

### Cuentas de Extensión (Polkadot.js Extension)

Cuentas importadas desde la extensión Polkadot.js:
- Requieren que tengas la extensión instalada
- Necesitan fondos para pagar fees en redes públicas
- Se firman automáticamente usando la extensión

## 💾 Base de Datos Local (IndexedDB)

La aplicación usa IndexedDB para persistencia local de:

### Datos Almacenados

- **Metadata de Polls:**
  - `pollId`, `title`, `description`
  - `optionNames`, `maxOptions`
  - `duration`, `endsAt`, `createdAt`
  - `totalVotes`, `isActive`, `creator`
  - `blockNumber`, `blockHash`, `transactionHash`
  - `chainMetadata`, `lastSynced`

- **Registros de Votos:**
  - `pollId`, `timestamp`
  - `option`, `proof`, `nullifier`

### Sincronización

Los datos se sincronizan automáticamente:
- Al cargar la aplicación
- Cada 5 segundos (para actualizar votos y tiempo restante)
- Manualmente con el botón "🔄 Sincronizar"

La base de datos local actúa como caché y complemento de los datos on-chain. Los datos del contrato tienen prioridad (son la fuente de verdad).

## 🛣️ Roadmap

### Fase 1: Funcionalidad Básica ✅ (Completado)

- [x] Compilación y despliegue del contrato
- [x] Frontend básico funcional
- [x] Creación y listado de polls
- [x] Sistema de cuentas
- [x] Base de datos local
- [x] Sistema de logging

### Fase 2: Integración ZK con Noir 🔄 (En Progreso)

- [ ] Compilar circuito Noir y generar artifacts
- [ ] Integrar `@noir-lang/noir_js` en el frontend
- [ ] Generar pruebas ZK al votar
- [ ] Verificar pruebas en el contrato
- [ ] Implementar sistema de nullifiers
- [ ] Generar Merkle Tree para votantes elegibles

### Fase 3: Primitivos de Criptografía 🔜 (Pendiente)

- [ ] Implementar firmas criptográficas con Polkadot.js
- [ ] Validación de firmas en el frontend
- [ ] Integración con wallets externos (Talisman, SubWallet)
- [ ] Manejo de claves y seguridad
- [ ] Encriptación de datos sensibles

### Fase 4: Despliegue en Redes Públicas 🔜 (Pendiente)

- [ ] Deploy del contrato en Paseo Testnet
- [ ] Obtener tokens de prueba (PAS)
- [ ] Configurar direcciones de contrato por red
- [ ] Testing en testnet
- [ ] Deploy en Polkadot Mainnet (cuando esté listo)
- [ ] Documentación de despliegue

### Fase 5: Integración con OpenGov 🔜 (Futuro)

- [ ] Conectores con sistemas de governance de Polkadot
- [ ] Mapeo de propuestas de OpenGov a polls
- [ ] Notificaciones automáticas de nuevas propuestas
- [ ] Dashboard de participación ciudadana
- [ ] Análisis y reportes de votación

### Fase 6: Mejoras y Optimizaciones 🔜 (Futuro)

- [ ] Optimización de gas costs
- [ ] Mejora de UX/UI
- [ ] Soporte multi-idioma
- [ ] Tests automatizados
- [ ] Documentación completa de API

## 🧪 Testing

### Scripts de Testing Incluidos

El proyecto incluye varios scripts de testing y diagnóstico:

#### 1. Diagnóstico del Contrato

```bash
# Verificar estado del contrato y nodo
node scripts/diagnose-contract.js
```

Este script verifica:
- Conexión al nodo
- Estado del contrato
- Polls existentes
- Eventos recientes
- Integración con Noir/ZK

#### 2. Tests End-to-End

```bash
# Ejecutar tests completos (crear poll, votar, verificar)
node scripts/test-e2e.js
```

Este script:
- Crea una poll de prueba
- Verifica que se creó correctamente
- Vota en la poll
- Verifica que el voto se registró
- Compara resultados

#### 3. Desplegar Contrato

```bash
# Desplegar el contrato en ink-node local
bash scripts/deploy-ink-contract.sh
```

#### 4. Compilar Circuito Noir

```bash
# Compilar y probar el circuito ZK
bash scripts/build-circuit.sh
```

### Verificar que el Contrato Funciona

```bash
cd contracts

# Obtener total de polls
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message get_total_polls \
  --suri //Alice \
  --url ws://localhost:9944 \
  --skip-confirm

# Crear una poll
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message create_poll \
  --args "Test Poll" "Description" "0x0101010101010101010101010101010101010101010101010101010101010101" 3 86400 \
  --suri //Alice \
  --url ws://localhost:9944 \
  --execute
```

### Verificar el Frontend

1. Abre `http://localhost:5173`
2. Verifica que se conecta al nodo
3. Verifica que carga las polls del contrato
4. Prueba crear una nueva poll
5. Revisa los logs en el modal "📊 Logs"

## 📁 Estructura del Proyecto

```
zk-anonymous-poll/
├── contracts/          # Contrato Ink! (Rust)
│   ├── lib.rs         # Lógica del contrato
│   └── Cargo.toml
├── circuits/          # Circuitos Noir (Zero-Knowledge)
│   ├── src/
│   │   ├── main.nr    # Circuito principal
│   │   └── merkle.nr  # Funciones de Merkle Tree
│   └── Cargo.toml
├── frontend/          # Frontend React + TypeScript
│   ├── src/
│   │   ├── components/    # Componentes React
│   │   ├── utils/         # Utilidades (database, polkadot, logger)
│   │   └── config.ts      # Configuración
│   └── package.json
├── scripts/           # Scripts de utilidad y testing
│   ├── deploy-ink-contract.sh  # Script para desplegar el contrato
│   ├── diagnose-contract.js    # Script de diagnóstico del contrato
│   ├── test-e2e.js            # Tests end-to-end
│   └── build-circuit.sh       # Script para compilar circuitos Noir
├── docs/              # Documentación adicional
│   ├── DEPLOYMENT_INFO.md      # Información de despliegue
│   ├── DIAGNOSTICO.md          # Guía de diagnóstico
│   ├── INTEGRACION_SOLIDITY_NOIR.md  # Integración con Noir
│   └── SOLUCION_BD.md          # Solución de problemas de BD
└── README.md
```

## 🔧 Configuración

### Variables de Entorno

No se requieren variables de entorno actualmente. La configuración está en:

- `frontend/src/config.ts` - Direcciones de contrato y URLs de nodos
- `contracts/lib.rs` - Configuración del contrato

### Redes Disponibles

- **ink-local**: `ws://localhost:9944` (desarrollo)
- **Paseo Testnet**: `wss://paseo.rpc.amforc.com` (no deployado aún)
- **Polkadot Mainnet**: `wss://rpc.polkadot.io` (no deployado aún)

## 🐛 Solución de Problemas

### El contrato no se carga

1. Verifica que ink-node esté corriendo: `curl http://localhost:9944`
2. Verifica la dirección del contrato en `frontend/src/config.ts`
3. Revisa los logs en el modal "📊 Logs"

### Las polls no aparecen

1. Haz clic en "🔄 Sincronizar"
2. Abre la consola y ejecuta: `await diagnosePolls()`
3. Verifica que el contrato tenga polls: `await getTotalPolls()`

### Error al crear poll

1. Verifica que tengas una cuenta seleccionada
2. Si estás en Paseo/Polkadot, cambia a ink-local (el contrato solo está deployado ahí)
3. Verifica que la cuenta tenga fondos suficientes

### Error de AccountId

Si ves "Invalid AccountId provided, expected 32 bytes, found 20":
- Esto ya está resuelto en el código actual
- Asegúrate de usar la última versión del código

## 📚 Documentación Adicional

- [DIAGNOSTICO.md](./DIAGNOSTICO.md) - Guía de diagnóstico de problemas
- [DEPLOYMENT_INFO.md](./DEPLOYMENT_INFO.md) - Información de despliegue
- [INTEGRACION_SOLIDITY_NOIR.md](./INTEGRACION_SOLIDITY_NOIR.md) - Integración con Noir
- [frontend/README.md](./frontend/README.md) - Documentación del frontend

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto está bajo la Licencia MIT. Ver `LICENSE` para más detalles.

## 🙏 Agradecimientos

Este proyecto no sería posible sin las siguientes contribuciones:

- **[@lynette7](https://github.com/lynette7)** - Por la base inicial del proyecto y su trabajo fundamental
- [Ink!](https://use.ink/) - Framework para smart contracts en Substrate
- [Noir](https://noir-lang.org/) - Lenguaje para circuitos Zero-Knowledge
- [Polkadot.js](https://polkadot.js.org/) - Biblioteca JavaScript para Polkadot
- [Substrate](https://substrate.io/) - Framework de blockchain

---

**Nota:** Este proyecto está en desarrollo activo. Muchas funcionalidades están aún en implementación. Para producción, se requiere completar la integración ZK con Noir y el despliegue en redes públicas.
