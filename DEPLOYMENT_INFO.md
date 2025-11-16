# Información de Despliegue

## Contrato Desplegado

**Dirección del Contrato:** `0x5801b439a678d9d3a68b8019da6a4abfa507de11`

**Red:** ink-node local (Development)
**URL:** `ws://localhost:9944`

**Fecha de Despliegue:** $(date)

## Configuración

- **Verificador (temporal):** `0x0000000000000000000000000000000000000001`
- **Cuenta de Despliegue:** `//Alice`
- **Modo:** RELEASE (45.8K optimizado)

## Comandos Útiles

### Llamar al contrato

```bash
cd contracts

# Obtener el owner
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message get_owner \
  --suri //Alice \
  --url ws://localhost:9944 \
  --skip-confirm

# Obtener total de polls
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message get_total_polls \
  --suri //Alice \
  --url ws://localhost:9944 \
  --skip-confirm

# Crear un poll
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message create_poll \
  --args "Test Poll" "Description" "0x0101010101010101010101010101010101010101010101010101010101010101" 3 86400 \
  --suri //Alice \
  --url ws://localhost:9944 \
  --execute
```

## Próximos Pasos

1. Desplegar el verificador de Solidity en una red que lo soporte
2. Actualizar la dirección del verificador en el contrato (si es necesario)
3. Crear polls y probar la funcionalidad completa

