# Integración Solidity-Noir para ZK Proofs

## Resumen

Este proyecto usa **Noir** para generar pruebas ZK (Zero-Knowledge) y **Solidity** para verificar esas pruebas en el contrato Ink!. El flujo completo es:

1. **Noir**: Genera la prueba ZK del voto anónimo
2. **Solidity Verifier**: Verifica la prueba ZK
3. **Ink! Contract**: Llama al verifier de Solidity y almacena el voto

## Arquitectura

```
┌─────────────┐
│   Frontend  │
│  (React)    │
└──────┬──────┘
       │
       │ 1. Genera prueba ZK con Noir
       ▼
┌─────────────┐
│   Circuito   │
│    Noir      │
│  (main.nr)   │
└──────┬──────┘
       │
       │ 2. Compila a verifier Solidity
       ▼
┌─────────────┐
│   Verifier   │
│   Solidity   │
│  (Contract)  │
└──────┬──────┘
       │
       │ 3. Verifica prueba
       ▼
┌─────────────┐
│   Ink!      │
│  Contract   │
│ (lib.rs)    │
└─────────────┘
```

## Paso 1: Compilar el Circuito Noir

El circuito Noir está en `circuits/src/main.nr`. Para compilarlo:

```bash
cd circuits
nargo compile
```

Esto genera:
- `target/main.json` - El circuito compilado
- `target/main.sol` - El verifier de Solidity (si está configurado)

## Paso 2: Generar el Verifier de Solidity

### Opción A: Usando nargo (si está disponible)

```bash
cd circuits
nargo codegen-verifier
```

Esto genera un contrato Solidity que puedes desplegar.

### Opción B: Usando herramientas externas

1. **NoirJS + Barretenberg**: Para generar pruebas en el frontend
2. **Circom/SNARKjs**: Si necesitas convertir el circuito

## Paso 3: Desplegar el Verifier de Solidity

El verifier de Solidity debe desplegarse en una red compatible. Para desarrollo local:

### Usando Hardhat/Foundry

```bash
# Si usas Foundry
forge install
forge build
forge deploy --rpc-url http://localhost:8545

# Si usas Hardhat
npx hardhat compile
npx hardhat deploy --network localhost
```

### Obtener la dirección del verifier

Después de desplegar, obtén la dirección del contrato verifier (ej: `0x1234...`)

## Paso 4: Actualizar el Contrato Ink!

El contrato Ink! ya tiene la estructura para llamar al verifier. Solo necesitas actualizar la dirección:

```rust
// En contracts/lib.rs, el constructor recibe verifier_address
pub fn new(verifier_address: H160) -> Self {
    // ...
}
```

Para actualizar la dirección del verifier después del despliegue:

```bash
cd contracts
cargo contract call \
  --contract 0x5801b439a678d9d3a68b8019da6a4abfa507de11 \
  --message update_verifier \
  --args 0x[NUEVA_DIRECCION_DEL_VERIFIER] \
  --suri //Alice \
  --url ws://localhost:9944 \
  --execute
```

## Paso 5: Generar Pruebas ZK en el Frontend

### Instalación de dependencias

```bash
cd frontend
npm install @noir-lang/noir_js @noir-lang/backend_barretenberg
```

### Generar la prueba

```typescript
import { Noir } from '@noir-lang/noir_js'
import { BarretenbergBackend } from '@noir-lang/backend_barretenberg'
import mainCircuit from '../circuits/target/main.json'

async function generateProof(voteData: {
  merkleRoot: string
  nullifier: string
  pollId: number
  maxOptions: number
  selectedOption: number
}) {
  // Cargar el circuito
  const backend = new BarretenbergBackend(mainCircuit)
  const noir = new Noir(mainCircuit)
  
  // Preparar inputs privados y públicos
  const inputs = {
    // Inputs privados (secretos)
    secret: voteData.secret,
    pathElements: voteData.pathElements,
    pathIndices: voteData.pathIndices,
    
    // Inputs públicos
    merkle_root: voteData.merkleRoot,
    nullifier: voteData.nullifier,
    poll_id: voteData.pollId,
    max_options: voteData.maxOptions,
    selected_option: voteData.selectedOption
  }
  
  // Generar la prueba
  const proof = await noir.generateFinalProof(inputs)
  
  return {
    proof: proof.proof,
    publicInputs: proof.publicInputs
  }
}
```

## Paso 6: Enviar el Voto al Contrato

```typescript
// En VoteModal.tsx o similar
const proofData = await generateProof({
  merkleRoot: poll.merkleRoot,
  nullifier: generateNullifier(secret, pollId),
  pollId: poll.id,
  maxOptions: poll.maxOptions,
  selectedOption: selectedOption
})

// Enviar al contrato
await contract.tx.castVote(
  { value: 0, gasLimit },
  pollId,
  proofData.proof,
  proofData.nullifier,
  selectedOption
)
```

## Verificación del Flujo Completo

### 1. Verificar que el circuito compila

```bash
cd circuits
nargo compile
# Debe generar target/main.json sin errores
```

### 2. Verificar que el verifier está desplegado

```bash
# Consultar la dirección del verifier en el contrato
node scripts/diagnose-contract.js
# Busca "Verifier address" en la salida
```

### 3. Verificar que las pruebas se generan

En el frontend, abre la consola y verifica que:
- El circuito se carga correctamente
- Las pruebas se generan sin errores
- Los public inputs son correctos

### 4. Verificar que el contrato acepta las pruebas

Al votar, verifica en los logs:
- ✅ La transacción se envía correctamente
- ✅ El verifier acepta la prueba
- ✅ El voto se registra en el contrato

## Troubleshooting

### Error: "Verifier address no configurado"

**Solución**: Despliega el verifier de Solidity y actualiza la dirección en el contrato.

### Error: "Proof verification failed"

**Causas posibles**:
1. Los public inputs no coinciden
2. El circuito no está compilado correctamente
3. El verifier no está actualizado

**Solución**: 
- Verifica que los public inputs sean exactamente los mismos que en el circuito
- Recompila el circuito
- Verifica que el verifier esté desplegado correctamente

### Error: "Invalid merkle root"

**Solución**: Asegúrate de que el merkle root en el contrato coincida con el del circuito.

## Estado Actual

Según el diagnóstico:
- ✅ Circuitos Noir presentes y compilados
- ⚠️ Verifier address es temporal/placeholder (`0x0000...0001`)
- ⚠️ Necesitas desplegar el verifier de Solidity para usar ZK proofs

## Próximos Pasos

1. **Compilar el circuito Noir a verifier Solidity**
   ```bash
   cd circuits
   nargo codegen-verifier
   ```

2. **Desplegar el verifier en una red compatible**
   - Usa Hardhat/Foundry para desarrollo local
   - O despliega en una testnet compatible

3. **Actualizar la dirección del verifier en el contrato**
   ```bash
   cargo contract call --message update_verifier --args [DIRECCION]
   ```

4. **Integrar la generación de pruebas en el frontend**
   - Instalar dependencias de Noir
   - Implementar `generateProof()` en `VoteModal.tsx`

5. **Probar el flujo completo**
   - Crear una poll
   - Generar una prueba ZK
   - Enviar el voto
   - Verificar que se registra correctamente

## Referencias

- [Noir Documentation](https://noir-lang.org/)
- [Ink! Documentation](https://use.ink/)
- [Polkadot.js API](https://polkadot.js.org/docs/)
- [Barretenberg Backend](https://github.com/noir-lang/noir/tree/master/backends/barretenberg)


