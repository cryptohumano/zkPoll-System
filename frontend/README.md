# Frontend - ZK Anonymous Poll

Frontend interactivo para el sistema de votación anónima con Zero-Knowledge Proofs.

## 🚀 Inicio Rápido

```bash
# Instalar dependencias
corepack yarn install

# Iniciar servidor de desarrollo
corepack yarn dev

# El frontend estará disponible en http://localhost:3000
```

## 📋 Requisitos

1. **ink-node corriendo**: El nodo debe estar ejecutándose en `ws://localhost:9944`
   ```bash
   ./ink-node --dev --tmp
   ```

2. **Extensión de Polkadot.js** (opcional para desarrollo local):
   - Instala la extensión desde: https://polkadot.js.org/extension/
   - Para desarrollo local, puedes usar cuentas de prueba

## 🎯 Funcionalidades

- ✅ **Listar Encuestas**: Ver todas las encuestas disponibles
- ✅ **Crear Encuestas**: Crear nuevas encuestas con título, descripción y opciones
- ✅ **Votar**: Votar en encuestas activas (requiere prueba ZK en producción)
- ✅ **Ver Resultados**: Ver resultados en tiempo real

## 🔧 Configuración

La dirección del contrato y la URL del nodo se configuran en `src/config.ts`:

```typescript
export const CONTRACT_ADDRESS = '0x5801b439a678d9d3a68b8019da6a4abfa507de11'
export const NODE_URL = 'ws://localhost:9944'
```

## 📝 Notas de Desarrollo

- El ABI del contrato se carga desde `public/contracts/target/ink/contracts.json`
- Para votar en producción, necesitarás generar pruebas ZK válidas usando el circuito Noir
- Actualmente usa valores mock para las pruebas ZK (solo para desarrollo)

