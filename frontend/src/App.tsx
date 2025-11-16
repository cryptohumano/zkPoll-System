import { useState, useEffect } from 'react'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { ContractPromise } from '@polkadot/api-contract'
import PollList from './components/PollList'
import CreatePoll from './components/CreatePoll'
import VoteModal from './components/VoteModal'
import AccountSelector from './components/AccountSelector'
import { CONTRACT_ADDRESS, loadContractAbi, NODE_CONFIGS, NodeType, DEFAULT_NODE } from './config'
import { AccountInfo, setApiSigner } from './utils/polkadot'
import { initDatabase, debugDatabase, getAllPollMetadata } from './utils/database'
import { logger } from './utils/logger'
import { syncAllPollsMetadata, getPollMetadataFromContract } from './utils/contract-metadata'
import { getDevAccounts } from './utils/polkadot'
import LogsModal from './components/LogsModal'
import './App.css'

// Exponer funciones de debug en la consola del navegador
if (typeof window !== 'undefined') {
  const win = window as any
  
  win.debugPollDatabase = async () => {
    await debugDatabase()
  }
  
  // Función de diagnóstico que puede funcionar en cualquier momento
  // Usa window.contract y window.api si están disponibles
  win.diagnosePolls = async () => {
    console.log('🔍 Iniciando diagnóstico completo...')
    
    try {
      // Obtener contrato y API desde window (si están disponibles)
      const contract = win.contract
      const api = win.api
      
      // 1. Verificar conexión
      console.log('\n1️⃣ Verificando conexión...')
      if (!api) {
        console.error('   ❌ API no disponible. Espera a que la aplicación se conecte al nodo.')
        console.log('   💡 Recarga la página y espera unos segundos antes de ejecutar diagnosePolls()')
        return
      }
      const isConnected = api.isConnected || false
      console.log(`   Conexión: ${isConnected ? '✅ Conectado' : '❌ Desconectado'}`)
      
      // 2. Verificar contrato
      console.log('\n2️⃣ Verificando contrato...')
      if (!contract) {
        console.error('   ❌ Contrato no disponible. Espera a que la aplicación cargue el contrato.')
        console.log('   💡 Recarga la página y espera unos segundos antes de ejecutar diagnosePolls()')
        return
      }
      console.log(`   Dirección: ${contract.address}`)
      console.log(`   ABI disponible: ${contract.abi ? '✅' : '❌'}`)
      
      // 3. Obtener cuenta de query
      console.log('\n3️⃣ Obteniendo dirección de query...')
      const devAccounts = await getDevAccounts()
      const queryAddress = devAccounts[0]?.address
      console.log(`   Dirección de query: ${queryAddress || '❌ No disponible'}`)
      
      if (!queryAddress) {
        console.error('❌ No se puede continuar sin dirección de query')
        return
      }
      
      // 4. Consultar getTotalPolls
      console.log('\n4️⃣ Consultando getTotalPolls...')
      const gasLimit = contract.abi.registry.createType('WeightV2', {
        refTime: 100000000000,
        proofSize: 1000000
      }) as any
      
      const totalResult = await contract.query.getTotalPolls(
        queryAddress,
        { value: 0, gasLimit }
      )
      
      console.log('   Resultado completo:', totalResult)
      console.log('   Output:', totalResult.output)
      console.log('   Output type:', typeof totalResult.output)
      
      if (totalResult.output) {
        try {
          const human = totalResult.output.toHuman?.()
          console.log('   Output (human):', JSON.stringify(human, null, 2))
        } catch (e) {
          console.log('   Error convirtiendo a human:', e)
        }
        
        if (typeof totalResult.output === 'object' && 'toNumber' in totalResult.output) {
          console.log('   Output (toNumber):', (totalResult.output as any).toNumber())
        }
        
        // Verificar todas las propiedades
        if (typeof totalResult.output === 'object') {
          console.log('   Propiedades del output:', Object.keys(totalResult.output))
          for (const key of Object.keys(totalResult.output)) {
            console.log(`   - ${key}:`, (totalResult.output as any)[key])
          }
        }
      }
      
      // 5. Verificar IndexedDB
      console.log('\n5️⃣ Verificando IndexedDB...')
      try {
        const allMetadata = await getAllPollMetadata()
        console.log(`   Polls en BD: ${allMetadata.length}`)
        if (allMetadata.length > 0) {
          console.log('   Primera poll:', JSON.stringify(allMetadata[0], null, 2))
        }
      } catch (e) {
        console.error('   Error accediendo a BD:', e)
      }
      
      // 6. Intentar obtener una poll específica
      console.log('\n6️⃣ Intentando obtener poll #1...')
      try {
        const poll1 = await contract.query.getPoll(
          queryAddress,
          { value: 0, gasLimit },
          1
        )
        console.log('   Resultado:', poll1)
        if (poll1.output) {
          const human = poll1.output.toHuman?.()
          console.log('   Output (human):', JSON.stringify(human, null, 2))
        }
      } catch (e) {
        console.error('   Error obteniendo poll #1:', e)
      }
      
      console.log('\n✅ Diagnóstico completado')
      console.log('\n💡 Prueba estos comandos:')
      console.log('   - await syncAllPolls()')
      console.log('   - await getPollFromContract(1)')
      console.log('   - debugPollDatabase()')
    } catch (error: any) {
      console.error('❌ Error en diagnóstico:', error)
      console.error('   Stack:', error.stack)
    }
  }
}

function App() {
  const [api, setApi] = useState<ApiPromise | null>(null)
  const [contract, setContract] = useState<ContractPromise | null>(null)
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedPoll, setSelectedPoll] = useState<number | null>(null)
  const [showCreatePoll, setShowCreatePoll] = useState(false)
  const [showAccountSelector, setShowAccountSelector] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<AccountInfo | null>(null)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [nodeType, setNodeType] = useState<NodeType>(DEFAULT_NODE)
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    const initialize = async () => {
      try {
        // Inicializar la base de datos local primero
        logger.info('Inicializando aplicación...', null, 'app')
        await initDatabase()
        logger.success('Base de datos local inicializada correctamente', null, 'database')
      } catch (error: any) {
        logger.error('Error inicializando base de datos', error, 'database')
        // Continuar aunque falle la BD, la app puede funcionar sin ella
      }

      const connect = async () => {
        try {
          logger.info(`Conectando a nodo: ${NODE_CONFIGS[nodeType].name}`, { url: NODE_CONFIGS[nodeType].url }, 'api')
          const nodeConfig = NODE_CONFIGS[nodeType]
          const provider = new WsProvider(nodeConfig.url)
          const apiInstance = await ApiPromise.create({ provider })
          setApi(apiInstance)
          
          // Obtener información de la cadena
          const [chain, blockNumber] = await Promise.all([
            apiInstance.rpc.system.chain(),
            apiInstance.rpc.chain.getBlockHash().then(hash => 
              apiInstance.rpc.chain.getBlock(hash).then(b => b.block.header.number.toNumber())
            )
          ])
          
          logger.success('Conectado a la API de Polkadot', { chain: chain.toString(), blockNumber }, 'api')
          logger.blockchain(`Cadena: ${chain}, Bloque: #${blockNumber}`, { chain: chain.toString(), blockNumber })
          
          const contractAbi = await loadContractAbi()
          const contractInstance = new ContractPromise(apiInstance, contractAbi, CONTRACT_ADDRESS)
          setContract(contractInstance)
          logger.success('Contrato cargado', { address: CONTRACT_ADDRESS }, 'contract')
          
          // Exponer funciones de sincronización con el contrato
          if (typeof window !== 'undefined') {
            const win = window as any
            win.syncAllPolls = async () => {
              return await syncAllPollsMetadata(contractInstance)
            }
            win.getPollFromContract = async (pollId: number) => {
              return await getPollMetadataFromContract(contractInstance, pollId)
            }
            win.contract = contractInstance // Exponer el contrato también
            win.api = apiInstance // Exponer la API también
            // Nota: diagnosePolls ya está disponible desde el inicio del script
          }
          
          setConnected(true)
        } catch (error: any) {
          logger.error('Error conectando al nodo', error, 'api')
        } finally {
          setLoading(false)
        }
      }

      connect()
    }

    initialize()
  }, [nodeType])

  const handleAccountSelected = async (account: AccountInfo) => {
    if (!api) return
    
    try {
      await setApiSigner(api, account.address, account.isDevAccount)
      setSelectedAccount(account)
      
      // Ejecutar acción pendiente si existe
      if (pendingAction) {
        pendingAction()
        setPendingAction(null)
      }
    } catch (error) {
      console.error('Error configurando signer:', error)
    }
  }

  const requestAccount = (action: () => void) => {
    if (selectedAccount) {
      // Si ya hay una cuenta seleccionada, ejecutar directamente
      action()
    } else {
      // Si no, pedir selección de cuenta
      setPendingAction(() => action)
      setShowAccountSelector(true)
    }
  }

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Conectando al nodo...</div>
      </div>
    )
  }

  if (!connected || !contract) {
    return (
      <div className="app">
        <div className="error">
          <h2>Error de Conexión</h2>
          <p>No se pudo conectar al nodo ink-node en ws://localhost:9944</p>
          <p>Asegúrate de que el nodo esté corriendo:</p>
          <code>./ink-node --dev --tmp</code>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🗳️ ZK Anonymous Poll</h1>
        <p>Sistema de Votación Anónima con Zero-Knowledge Proofs</p>
        <div className="header-controls">
          <div className="node-selector">
            <label>Nodo:</label>
            <select 
              value={nodeType} 
              onChange={(e) => {
                setNodeType(e.target.value as NodeType)
                setSelectedAccount(null) // Reset cuenta al cambiar nodo
              }}
              className="node-select"
            >
              {Object.entries(NODE_CONFIGS).map(([key, config]) => (
                <option key={key} value={key}>{config.name}</option>
              ))}
            </select>
          </div>
          <button 
            className="btn-logs"
            onClick={() => setShowLogs(true)}
            title="Ver logs del sistema"
          >
            📊 Logs
          </button>
          {contract && (
            <button 
              className="btn-sync"
              onClick={async () => {
                if (contract) {
                  logger.info('Iniciando sincronización de todas las polls...', null, 'database')
                  try {
                    const synced = await syncAllPollsMetadata(contract)
                    logger.success(`${synced.length} polls sincronizadas`, { count: synced.length }, 'database')
                    alert(`✅ ${synced.length} polls sincronizadas exitosamente`)
                    // Recargar la página para ver los cambios
                    window.location.reload()
                  } catch (e: any) {
                    logger.error('Error sincronizando polls', e, 'database')
                    alert(`❌ Error sincronizando: ${e.message}`)
                  }
                }
              }}
              title="Sincronizar todas las polls con el contrato"
            >
              🔄 Sincronizar
            </button>
          )}
        </div>
        <div className="header-actions">
          {selectedAccount && (
            <div className="account-badge">
              <span>👤 {selectedAccount.meta.name || 'Cuenta'}</span>
              {selectedAccount.isDevAccount && <span className="dev-badge-small">DEV</span>}
              <button 
                className="btn-change-account"
                onClick={() => {
                  setSelectedAccount(null)
                  setShowAccountSelector(true)
                }}
              >
                Cambiar
              </button>
            </div>
          )}
          <button 
            className="btn-primary"
            onClick={() => {
              if (selectedAccount) {
                setShowCreatePoll(true)
              } else {
                requestAccount(() => setShowCreatePoll(true))
              }
            }}
          >
            + Crear Nueva Encuesta
          </button>
        </div>
      </header>

      <main className="main">
        {contract && (
          <PollList 
            contract={contract} 
            onVoteClick={setSelectedPoll}
          />
        )}
      </main>

      {showCreatePoll && contract && api && (
        <CreatePoll
          contract={contract}
          api={api}
          selectedAccount={selectedAccount}
          onClose={() => setShowCreatePoll(false)}
        />
      )}

      {selectedPoll !== null && contract && (
        <VoteModal
          contract={contract}
          pollId={selectedPoll}
          selectedAccount={selectedAccount}
          onRequestAccount={() => requestAccount(() => {})}
          onClose={() => setSelectedPoll(null)}
        />
      )}

      {showAccountSelector && (
        <AccountSelector
          nodeType={nodeType}
          onAccountSelected={handleAccountSelected}
          onClose={() => {
            setShowAccountSelector(false)
            setPendingAction(null)
          }}
        />
      )}

      {showLogs && (
        <LogsModal
          isOpen={showLogs}
          onClose={() => setShowLogs(false)}
        />
      )}
    </div>
  )
}

export default App

