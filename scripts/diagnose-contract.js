#!/usr/bin/env node

/**
 * Script de diagnóstico para verificar el estado del contrato y el nodo
 * Uso: node scripts/diagnose-contract.js
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

const CONTRACT_ADDRESS = '0x5801b439a678d9d3a68b8019da6a4abfa507de11'
const NODE_URL = 'ws://localhost:9944'

async function diagnose() {
  console.log('🔍 Iniciando diagnóstico del contrato...\n')

  // 1. Verificar conexión al nodo
  console.log('1️⃣ Verificando conexión al nodo...')
  let api
  try {
    const provider = new WsProvider(NODE_URL)
    api = await ApiPromise.create({ provider })
    console.log('✅ Conectado al nodo:', NODE_URL)
    
    const [chain, nodeName, nodeVersion] = await Promise.all([
      api.rpc.system.chain(),
      api.rpc.system.name(),
      api.rpc.system.version()
    ])
    
    console.log(`   - Cadena: ${chain}`)
    console.log(`   - Nodo: ${nodeName} v${nodeVersion}`)
    
    try {
      const blockHash = await api.rpc.chain.getBlockHash()
      const block = await api.rpc.chain.getBlock(blockHash)
      const blockNumber = block.block.header.number.toNumber()
      console.log(`   - Bloque actual: #${blockNumber}`)
      console.log(`   - Hash del bloque: ${blockHash.toHex()}\n`)
    } catch (e) {
      console.log(`   - Hash del bloque: (no disponible)\n`)
    }
  } catch (error) {
    console.error('❌ Error conectando al nodo:', error.message)
    console.error('   Asegúrate de que el nodo esté corriendo:')
    console.error('   ./ink-node --dev --tmp')
    process.exit(1)
  }

  // 2. Cargar ABI del contrato
  console.log('2️⃣ Cargando ABI del contrato...')
  let contractAbi
  try {
    const abiPath = path.join(__dirname, '../frontend/public/contracts/target/ink/contracts.json')
    const abiContent = fs.readFileSync(abiPath, 'utf-8')
    contractAbi = JSON.parse(abiContent)
    console.log('✅ ABI cargado correctamente')
    console.log(`   - Contrato: ${contractAbi.contract.name}`)
    console.log(`   - Versión: ${contractAbi.contract.version}`)
    console.log(`   - Ink! versión: ${contractAbi.source.language}\n`)
  } catch (error) {
    console.error('❌ Error cargando ABI:', error.message)
    process.exit(1)
  }

  // 3. Crear instancia del contrato
  console.log('3️⃣ Creando instancia del contrato...')
  const contract = new ContractPromise(api, contractAbi, CONTRACT_ADDRESS)
  console.log(`✅ Contrato instanciado en: ${CONTRACT_ADDRESS}`)
  
  // Para queries, necesitamos usar una dirección AccountId32 válida
  // En ink-node, podemos usar la dirección de //Alice convertida
  let queryAddress = contract.address
  try {
    const { Keyring } = require(path.join(frontendNodeModules, '@polkadot/keyring'))
    const { cryptoWaitReady } = require(path.join(frontendNodeModules, '@polkadot/util-crypto'))
    await cryptoWaitReady()
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
    const alice = keyring.addFromUri('//Alice')
    queryAddress = alice.address
    console.log(`   - Usando dirección de query: ${queryAddress} (//Alice)\n`)
  } catch (e) {
    console.log(`   ⚠️ No se pudo obtener dirección de query, usando contract.address\n`)
  }

  // 4. Verificar métodos disponibles
  console.log('4️⃣ Verificando métodos del contrato...')
  const messages = contract.abi.messages
  console.log(`   - Métodos disponibles: ${messages.length}`)
  messages.forEach(msg => {
    console.log(`     • ${msg.label}`)
  })
  console.log()

  // 5. Consultar estado del contrato
  console.log('5️⃣ Consultando estado del contrato...')
  
  try {
    // Obtener total de polls (este método no requiere AccountId)
    const totalPollsResult = await contract.query.getTotalPolls(
      queryAddress,
      { value: 0, gasLimit: -1 }
    )
    if (totalPollsResult.output) {
      const totalPolls = totalPollsResult.output.toNumber()
      console.log(`   - Total de polls: ${totalPolls}`)
      
      // Listar polls existentes
      if (totalPolls > 0) {
        console.log('\n   📊 Polls existentes:')
        for (let i = 1; i <= totalPolls; i++) {
          try {
            const pollResult = await contract.query.getPoll(
              queryAddress,
              { value: 0, gasLimit: -1 },
              i
            )
            if (pollResult.output) {
              const output = pollResult.output.toHuman()
              if (output && output.Ok) {
                const [exists, id, title, description, , maxOptions, creator, isActive, totalVotes, createdAt, endsAt] = output.Ok
                if (exists) {
                  console.log(`     Poll #${id}:`)
                  console.log(`       - Título: ${title}`)
                  console.log(`       - Descripción: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`)
                  console.log(`       - Opciones: ${maxOptions}`)
                  console.log(`       - Votos totales: ${totalVotes}`)
                  console.log(`       - Activa: ${isActive}`)
                  // El creator viene como H160 (20 bytes), mostrarlo como hex
                  let creatorStr = creator
                  if (typeof creator === 'object' && creator !== null) {
                    creatorStr = Object.values(creator)[0] || JSON.stringify(creator)
                  }
                  console.log(`       - Creador: ${creatorStr}`)
                  if (createdAt && Number(createdAt) > 0) {
                    console.log(`       - Creada: ${new Date(Number(createdAt)).toLocaleString()}`)
                  }
                  
                  // Obtener tallies de votos
                  try {
                    const talliesResult = await contract.query.getAllTallies(
                      queryAddress,
                      { value: 0, gasLimit: -1 },
                      i
                    )
                    if (talliesResult.output && talliesResult.output.toHuman) {
                      const tallies = talliesResult.output.toHuman()
                      if (tallies && tallies.Ok && Array.isArray(tallies.Ok)) {
                        console.log(`       - Votos por opción: ${tallies.Ok.map((t, idx) => `Op${idx+1}:${t}`).join(', ')}`)
                      }
                    }
                  } catch (e) {
                    // Ignorar errores de tallies
                  }
                  console.log('')
                }
              }
            }
          } catch (e) {
            console.warn(`     ⚠️ Error obteniendo poll ${i}:`, e.message)
          }
        }
      } else {
        console.log('   ℹ️ No hay polls creados aún\n')
      }
    }

    // Intentar obtener owner (puede fallar por AccountId)
    try {
      const ownerResult = await contract.query.getOwner(
        queryAddress,
        { value: 0, gasLimit: -1 }
      )
      if (ownerResult.output) {
        console.log(`   - Owner: ${ownerResult.output.toHex()}`)
      }
    } catch (e) {
      console.log(`   ⚠️ No se pudo obtener owner (problema de AccountId32 vs H160)`)
    }

    // Intentar obtener dirección del verifier
    try {
      const verifierResult = await contract.query.getVerifierAddress(
        queryAddress,
        { value: 0, gasLimit: -1 }
      )
      if (verifierResult.output) {
        console.log(`   - Verifier address: ${verifierResult.output.toHex()}`)
      }
    } catch (e) {
      console.log(`   ⚠️ No se pudo obtener verifier address`)
    }
  } catch (error) {
    console.error('❌ Error consultando contrato:', error.message)
    if (error.message.includes('AccountId')) {
      console.error('   ℹ️ Nota: El contrato usa H160 (20 bytes) pero la API espera AccountId32 (32 bytes)')
      console.error('   Esto es normal para contratos Ink! que usan H160')
    }
  }

  // 6. Verificar eventos recientes del contrato
  console.log('6️⃣ Verificando eventos recientes del contrato...')
  try {
    // Obtener los últimos bloques y buscar eventos del contrato
    const currentBlock = await api.rpc.chain.getBlockHash()
    const block = await api.rpc.chain.getBlock(currentBlock)
    const blockNumber = block.block.header.number.toNumber()
    
    console.log(`   - Revisando últimos 10 bloques (hasta #${blockNumber})...`)
    
    let eventCount = 0
    const startBlock = Math.max(1, blockNumber - 10)
    
    for (let i = startBlock; i <= blockNumber; i++) {
      try {
        const blockHash = await api.rpc.chain.getBlockHash(i)
        const block = await api.rpc.chain.getBlock(blockHash)
        
        // Buscar eventos en este bloque
        if (block.block.extrinsics) {
          for (const extrinsic of block.block.extrinsics) {
            // Verificar si es una llamada al contrato
            const method = extrinsic.method
            if (method && method.section === 'contracts') {
              console.log(`   📋 Bloque #${i}: Encontrada llamada a contrato`)
              eventCount++
            }
          }
        }
      } catch (e) {
        // Ignorar errores al obtener bloques antiguos
      }
    }
    
    if (eventCount > 0) {
      console.log(`   ✅ Se encontraron ${eventCount} llamadas a contratos en los últimos bloques`)
    } else {
      console.log(`   ℹ️ No se encontraron llamadas a contratos en los últimos bloques`)
      console.log(`   💡 Sugerencia: Crea una poll desde el frontend para generar eventos`)
    }
  } catch (e) {
    console.warn(`   ⚠️ Error verificando eventos:`, e.message)
  }

  // 7. Verificar integración con Noir/ZK
  console.log('\n7️⃣ Verificando integración con Noir/ZK...')
  try {
    // Verificar que existe el directorio de circuitos
    const fs = require('fs')
    const path = require('path')
    const circuitsPath = path.join(__dirname, '../circuits')
    
    if (fs.existsSync(circuitsPath)) {
      console.log('   ✅ Directorio de circuitos encontrado')
      
      // Verificar archivos principales
      const mainNr = path.join(circuitsPath, 'src/main.nr')
      const merkleNr = path.join(circuitsPath, 'src/merkle.nr')
      
      if (fs.existsSync(mainNr)) {
        console.log('   ✅ Circuito principal (main.nr) encontrado')
        const content = fs.readFileSync(mainNr, 'utf-8')
        if (content.includes('verify') || content.includes('proof')) {
          console.log('   ✅ Circuito contiene funciones de verificación ZK')
        }
      }
      
      if (fs.existsSync(merkleNr)) {
        console.log('   ✅ Módulo Merkle (merkle.nr) encontrado')
      }
      
      // Verificar si hay compilación
      const targetPath = path.join(circuitsPath, 'target')
      if (fs.existsSync(targetPath)) {
        console.log('   ✅ Circuitos compilados encontrados')
      } else {
        console.log('   ⚠️ Circuitos no compilados - ejecuta: cd circuits && nargo compile')
      }
    } else {
      console.log('   ⚠️ Directorio de circuitos no encontrado')
    }
    
    // Verificar verifier address en el contrato
    try {
      const verifierResult = await contract.query.getVerifierAddress(
        queryAddress,
        { value: 0, gasLimit: -1 }
      )
      if (verifierResult.output) {
        const verifierAddr = verifierResult.output.toHex()
        console.log(`   - Verifier address: ${verifierAddr}`)
        if (verifierAddr === '0x0000000000000000000000000000000000000001') {
          console.log('   ⚠️ Verifier address es temporal/placeholder')
          console.log('   💡 Necesitas desplegar el verifier de Solidity para usar ZK proofs')
        } else if (verifierAddr === '0x0000000000000000000000000000000000000000') {
          console.log('   ❌ Verifier address no configurado')
        } else {
          console.log('   ✅ Verifier address configurado')
        }
      }
    } catch (e) {
      console.log('   ⚠️ No se pudo obtener verifier address')
    }
  } catch (e) {
    console.warn(`   ⚠️ Error verificando integración ZK:`, e.message)
  }

  console.log('\n✅ Diagnóstico completado')
  console.log('\n📝 Resumen:')
  console.log('   - Si no hay polls, crea una desde el frontend')
  console.log('   - Revisa la consola del navegador para ver logs detallados')
  console.log('   - Verifica que el nodo esté corriendo: ./ink-node --dev --tmp')
  console.log('   - Para usar ZK proofs, necesitas desplegar el verifier de Solidity')
  
  // Cerrar conexión
  await api.disconnect()
}

// Ejecutar diagnóstico
diagnose().catch(console.error)

