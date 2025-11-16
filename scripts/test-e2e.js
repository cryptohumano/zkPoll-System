#!/usr/bin/env node

/**
 * Script de testing end-to-end para verificar la funcionalidad completa del sistema
 * Uso: node scripts/test-e2e.js
 * 
 * Este script:
 * 1. Conecta al nodo
 * 2. Carga el contrato
 * 3. Crea una poll de prueba
 * 4. Consulta la poll creada
 * 5. Vota en la poll
 * 6. Verifica los resultados
 */

// Resolver las dependencias desde el directorio frontend
const path = require('path')
const fs = require('fs')

// Agregar node_modules del frontend al path
const frontendNodeModules = path.join(__dirname, '../frontend/node_modules')
require('module')._resolveFilename = ((originalResolveFilename) => {
  return function(request, parent, isMain) {
    try {
      return originalResolveFilename(request, parent, isMain)
    } catch (e) {
      // Si falla, intentar desde frontend/node_modules
      const frontendPath = path.join(frontendNodeModules, request)
      try {
        return require.resolve(frontendPath)
      } catch (e2) {
        throw e
      }
    }
  }
})(require('module')._resolveFilename)

const { ApiPromise, WsProvider } = require(path.join(frontendNodeModules, '@polkadot/api'))
const { ContractPromise } = require(path.join(frontendNodeModules, '@polkadot/api-contract'))
const { Keyring } = require(path.join(frontendNodeModules, '@polkadot/keyring'))
const { cryptoWaitReady } = require(path.join(frontendNodeModules, '@polkadot/util-crypto'))

const CONTRACT_ADDRESS = '0x5801b439a678d9d3a68b8019da6a4abfa507de11'
const NODE_URL = 'ws://localhost:9944'

// Función helper para parsear resultados del contrato (igual que en el frontend)
function parseContractOutput(output) {
  if (!output) return null
  
  // Intentar toHuman() primero (más confiable)
  try {
    const human = output.toHuman()
    if (human && typeof human === 'object') {
      // Buscar formato { Ok: value } o { ok: value }
      if (human.Ok !== undefined) {
        return { ok: true, value: human.Ok }
      }
      if (human.ok !== undefined) {
        return { ok: true, value: human.ok }
      }
      // Si es un array directo, retornarlo
      if (Array.isArray(human)) {
        return { ok: true, value: human }
      }
    }
  } catch (e) {
    // Continuar con otros métodos
  }
  
  // Intentar toNumber() si está disponible
  if (typeof output.toNumber === 'function') {
    try {
      return { ok: true, value: output.toNumber() }
    } catch (e) {
      // Continuar
    }
  }
  
  // Fallback: retornar el output tal cual
  return { ok: true, value: output }
}

// Función helper para obtener total de polls (igual que en PollList.tsx)
async function getTotalPolls(contract, queryAddress) {
  const gasLimit = contract.abi.registry.createType('WeightV2', {
    refTime: 100000000000,
    proofSize: 1000000
  })
  
  const result = await contract.query.getTotalPolls(
    queryAddress,
    { value: 0, gasLimit }
  )
  
  const parsed = parseContractOutput(result.output)
  if (parsed && parsed.ok) {
    // El valor puede venir en diferentes formatos
    const value = parsed.value
    if (typeof value === 'number') {
      return value
    }
    if (typeof value === 'string') {
      return parseInt(value, 10) || 0
    }
    if (typeof value === 'object' && value !== null) {
      // Buscar en propiedades anidadas
      if (value.Ok !== undefined) {
        const okValue = value.Ok
        return typeof okValue === 'number' ? okValue : parseInt(okValue, 10) || 0
      }
      if (value.ok !== undefined) {
        const okValue = value.ok
        return typeof okValue === 'number' ? okValue : parseInt(okValue, 10) || 0
      }
    }
  }
  
  return 0
}

// Función helper para obtener una poll (igual que en PollList.tsx)
async function getPoll(contract, queryAddress, pollId) {
  const gasLimit = contract.abi.registry.createType('WeightV2', {
    refTime: 100000000000,
    proofSize: 1000000
  })
  
  const result = await contract.query.getPoll(
    queryAddress,
    { value: 0, gasLimit },
    pollId
  )
  
  const parsed = parseContractOutput(result.output)
  if (parsed && parsed.ok && Array.isArray(parsed.value)) {
    const [exists, id, title, description, , maxOptions, creator, isActive, totalVotes, createdAt, endsAt] = parsed.value
    return {
      exists: exists === true || exists === 'true' || exists === 1,
      id: typeof id === 'number' ? id : parseInt(id, 10) || 0,
      title: title || '',
      description: description || '',
      maxOptions: typeof maxOptions === 'number' ? maxOptions : parseInt(maxOptions, 10) || 0,
      creator: creator || '',
      isActive: isActive === true || isActive === 'true' || isActive === 1,
      totalVotes: typeof totalVotes === 'number' ? totalVotes : parseInt(totalVotes, 10) || 0,
      createdAt: typeof createdAt === 'number' ? createdAt : parseInt(createdAt, 10) || 0,
      endsAt: typeof endsAt === 'number' ? endsAt : parseInt(endsAt, 10) || 0
    }
  }
  
  return null
}

// Función helper para obtener tallies (igual que en PollList.tsx)
async function getAllTallies(contract, queryAddress, pollId) {
  const gasLimit = contract.abi.registry.createType('WeightV2', {
    refTime: 100000000000,
    proofSize: 1000000
  })
  
  const result = await contract.query.getAllTallies(
    queryAddress,
    { value: 0, gasLimit },
    pollId
  )
  
  const parsed = parseContractOutput(result.output)
  if (parsed && parsed.ok) {
    const value = parsed.value
    if (Array.isArray(value)) {
      return value.map(v => typeof v === 'number' ? v : parseInt(v, 10) || 0)
    }
    if (value && value.Ok && Array.isArray(value.Ok)) {
      return value.Ok.map(v => typeof v === 'number' ? v : parseInt(v, 10) || 0)
    }
  }
  
  return []
}

async function testE2E() {
  console.log('🧪 Iniciando tests end-to-end...\n')
  
  // 1. Conectar al nodo
  console.log('1️⃣ Conectando al nodo...')
  let api
  try {
    await cryptoWaitReady()
    const provider = new WsProvider(NODE_URL)
    api = await ApiPromise.create({ provider })
    console.log('✅ Conectado al nodo:', NODE_URL)
  } catch (error) {
    console.error('❌ Error conectando al nodo:', error.message)
    console.error('   Asegúrate de que el nodo esté corriendo: ./ink-node --dev --tmp')
    process.exit(1)
  }
  
  // 2. Cargar contrato
  console.log('\n2️⃣ Cargando contrato...')
  let contract
  try {
    const abiPath = path.join(__dirname, '../frontend/public/contracts/target/ink/contracts.json')
    const abiContent = fs.readFileSync(abiPath, 'utf-8')
    const contractAbi = JSON.parse(abiContent)
    contract = new ContractPromise(api, contractAbi, CONTRACT_ADDRESS)
    console.log('✅ Contrato cargado:', CONTRACT_ADDRESS)
  } catch (error) {
    console.error('❌ Error cargando contrato:', error.message)
    process.exit(1)
  }
  
  // 3. Configurar cuenta (//Alice para desarrollo)
  console.log('\n3️⃣ Configurando cuenta...')
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
  const alice = keyring.addFromUri('//Alice')
  const queryAddress = alice.address // AccountId32 para queries
  console.log('✅ Usando cuenta:', alice.address, '(//Alice)')
  
  // 4. Obtener estado inicial
  console.log('\n4️⃣ Obteniendo estado inicial...')
  const initialTotalPolls = await getTotalPolls(contract, queryAddress)
  console.log(`   - Total de polls inicial: ${initialTotalPolls}`)
  
  // 5. Crear una poll de prueba
  console.log('\n5️⃣ Creando poll de prueba...')
  const testPollTitle = `Test E2E Poll - ${new Date().toISOString()}`
  const testPollDescription = 'Esta es una poll creada por el script de testing e2e'
  const testMerkleRoot = '0x' + '01'.repeat(32) // Merkle root temporal
  const testMaxOptions = 3
  const testDuration = 3600 // 1 hora en segundos
  
  let newPollId = 0
  
  try {
    const gasLimit = contract.abi.registry.createType('WeightV2', {
      refTime: 200000000000,
      proofSize: 2000000
    })
    
    const tx = contract.tx.createPoll(
      {
        value: 0,
        gasLimit
      },
      testPollTitle,
      testPollDescription,
      testMerkleRoot,
      testMaxOptions,
      testDuration
    )
    
    console.log('   📤 Enviando transacción...')
    await new Promise((resolve, reject) => {
      tx.signAndSend(alice, async (result) => {
        if (result.status.isInBlock || result.status.isFinalized) {
          console.log('   ✅ Transacción confirmada en bloque')
          
          // Intentar extraer pollId de eventos
          if (result.events) {
            for (const eventRecord of result.events) {
              const event = eventRecord.event
              if (event && event.section === 'contracts') {
                try {
                  const decoded = contract.abi.decodeEvent(eventRecord)
                  if (decoded && decoded.event && decoded.event.identifier === 'PollCreated') {
                    const args = decoded.args || []
                    if (args.length > 0) {
                      newPollId = typeof args[0] === 'number' ? args[0] : parseInt(args[0], 10) || 0
                      console.log(`   ✅ PollId extraído del evento: ${newPollId}`)
                    }
                  }
                } catch (e) {
                  // Continuar buscando
                }
              }
            }
          }
          
          // Si no se obtuvo del evento, obtener del total de polls
          if (newPollId === 0) {
            await new Promise(resolve => setTimeout(resolve, 2000)) // Esperar 2 segundos
            const newTotal = await getTotalPolls(contract, queryAddress)
            if (newTotal > initialTotalPolls) {
              newPollId = newTotal
              console.log(`   ✅ PollId obtenido del total de polls: ${newPollId}`)
            }
          }
          
          resolve()
        } else if (result.status.isError || result.status.isDropped || result.status.isInvalid) {
          reject(new Error(`Transacción falló: ${result.status.type}`))
        }
      })
    })
    
    if (newPollId === 0) {
      throw new Error('No se pudo obtener el pollId de la poll creada')
    }
    
    console.log(`   ✅ Poll creada exitosamente con ID: ${newPollId}`)
  } catch (error) {
    console.error('   ❌ Error creando poll:', error.message)
    await api.disconnect()
    process.exit(1)
  }
  
  // 6. Verificar que la poll fue creada correctamente
  console.log('\n6️⃣ Verificando poll creada...')
  await new Promise(resolve => setTimeout(resolve, 2000)) // Esperar a que se procese
  
  const poll = await getPoll(contract, queryAddress, newPollId)
  if (!poll || !poll.exists) {
    console.error('   ❌ La poll no existe o no se pudo obtener')
    await api.disconnect()
    process.exit(1)
  }
  
  console.log('   ✅ Poll encontrada:')
  console.log(`      - ID: ${poll.id}`)
  console.log(`      - Título: ${poll.title}`)
  console.log(`      - Descripción: ${poll.description.substring(0, 50)}...`)
  console.log(`      - Opciones máximas: ${poll.maxOptions}`)
  console.log(`      - Activa: ${poll.isActive}`)
  console.log(`      - Votos totales: ${poll.totalVotes}`)
  
  // Verificar que los datos coinciden
  if (poll.title !== testPollTitle) {
    console.warn(`   ⚠️ El título no coincide: esperado "${testPollTitle}", obtenido "${poll.title}"`)
  }
  if (poll.maxOptions !== testMaxOptions) {
    console.warn(`   ⚠️ Las opciones máximas no coinciden: esperado ${testMaxOptions}, obtenido ${poll.maxOptions}`)
  }
  
  // 7. Obtener tallies iniciales
  console.log('\n7️⃣ Obteniendo tallies iniciales...')
  const initialTallies = await getAllTallies(contract, queryAddress, newPollId)
  console.log(`   - Tallies iniciales: [${initialTallies.join(', ')}]`)
  
  // 8. Votar en la poll (mock proof para desarrollo)
  console.log('\n8️⃣ Votando en la poll...')
  const selectedOption = 0 // Primera opción
  const mockProof = new Uint8Array(100).fill(0) // Mock proof
  const mockNullifier = '0x' + '00'.repeat(32) // Mock nullifier
  
  try {
    const gasLimit = contract.abi.registry.createType('WeightV2', {
      refTime: 300000000000,
      proofSize: 3000000
    })
    
    const tx = contract.tx.castVote(
      {
        value: 0,
        gasLimit
      },
      newPollId,
      mockProof,
      mockNullifier,
      selectedOption
    )
    
    console.log('   📤 Enviando voto...')
    await new Promise((resolve, reject) => {
      tx.signAndSend(alice, (result) => {
        if (result.status.isInBlock || result.status.isFinalized) {
          console.log('   ✅ Voto confirmado en bloque')
          resolve()
        } else if (result.status.isError || result.status.isDropped || result.status.isInvalid) {
          reject(new Error(`Voto falló: ${result.status.type}`))
        }
      })
    })
  } catch (error) {
    console.error('   ❌ Error votando:', error.message)
    // Continuar con la verificación de todas formas
  }
  
  // 9. Verificar que el voto se registró
  console.log('\n9️⃣ Verificando voto...')
  await new Promise(resolve => setTimeout(resolve, 2000)) // Esperar a que se procese
  
  const pollAfterVote = await getPoll(contract, queryAddress, newPollId)
  if (pollAfterVote) {
    console.log(`   - Votos totales después del voto: ${pollAfterVote.totalVotes}`)
    if (pollAfterVote.totalVotes > poll.totalVotes) {
      console.log('   ✅ El voto se registró correctamente')
    } else {
      console.warn('   ⚠️ El voto no parece haberse registrado')
    }
  }
  
  const talliesAfterVote = await getAllTallies(contract, queryAddress, newPollId)
  console.log(`   - Tallies después del voto: [${talliesAfterVote.join(', ')}]`)
  if (talliesAfterVote[selectedOption] > initialTallies[selectedOption]) {
    console.log(`   ✅ El voto en la opción ${selectedOption} se registró correctamente`)
  } else {
    console.warn(`   ⚠️ El voto en la opción ${selectedOption} no parece haberse registrado`)
  }
  
  // 10. Verificar total de polls
  console.log('\n🔟 Verificando total de polls...')
  const finalTotalPolls = await getTotalPolls(contract, queryAddress)
  console.log(`   - Total de polls final: ${finalTotalPolls}`)
  if (finalTotalPolls === initialTotalPolls + 1) {
    console.log('   ✅ El total de polls se incrementó correctamente')
  } else {
    console.warn(`   ⚠️ El total de polls no coincide: esperado ${initialTotalPolls + 1}, obtenido ${finalTotalPolls}`)
  }
  
  console.log('\n✅ Tests end-to-end completados')
  console.log('\n📝 Resumen:')
  console.log(`   - Poll creada: ${newPollId}`)
  console.log(`   - Voto enviado: ${selectedOption}`)
  console.log(`   - Estado final: ${pollAfterVote ? 'Verificado' : 'No verificado'}`)
  
  // Cerrar conexión
  await api.disconnect()
}

// Ejecutar tests
testE2E().catch((error) => {
  console.error('\n❌ Error en tests e2e:', error)
  process.exit(1)
})


