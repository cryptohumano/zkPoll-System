import { useState, useEffect } from 'react'
import { ContractPromise } from '@polkadot/api-contract'
import { getPollMetadata } from '../utils/database'
import { getDevAccounts } from '../utils/polkadot'
import { logger } from '../utils/logger'
import { getPollMetadataFromContract, syncPollMetadata } from '../utils/contract-metadata'
import './PollList.css'

interface Poll {
  id: number
  title: string
  description: string
  maxOptions: number
  totalVotes: number
  isActive: boolean
  creator: string
  createdAt: number
  endsAt: number
  voteTallies: number[] // Votos por opción (índice = opción)
  optionNames?: string[] // Nombres de las opciones desde la BD local
}

interface PollListProps {
  contract: ContractPromise
  onVoteClick: (pollId: number) => void
  refreshTrigger?: number // Trigger para forzar recarga
}

export default function PollList({ contract, onVoteClick, refreshTrigger }: PollListProps) {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [queryAddress, setQueryAddress] = useState<string | null>(null)

  // Obtener una dirección AccountId32 válida para queries
  useEffect(() => {
    const initQueryAddress = async () => {
      try {
        // Usar //Alice como dirección de query (AccountId32 válido)
        const devAccounts = await getDevAccounts()
        if (devAccounts.length > 0) {
          setQueryAddress(devAccounts[0].address)
          logger.success('Dirección de query configurada', { address: devAccounts[0].address }, 'api')
        }
      } catch (e) {
        console.warn('⚠️ No se pudo obtener dirección de query:', e)
        // Fallback: intentar usar contract.address (puede fallar)
        setQueryAddress(contract.address.toString())
      }
    }
    initQueryAddress()
  }, [contract])

  useEffect(() => {
    if (queryAddress) {
      loadPolls()
      // Recargar cada 5 segundos para actualizar votos y tiempo restante
      const interval = setInterval(loadPolls, 5000)
      return () => clearInterval(interval)
    }
  }, [contract, queryAddress])

  // Recargar cuando cambie el refreshTrigger (después de crear una poll)
  useEffect(() => {
    if (!queryAddress) {
      logger.debug('Esperando queryAddress para verificación de nueva poll', null, 'contract')
      return
    }
    
    // Solo ejecutar si refreshTrigger tiene un valor válido (mayor que 0)
    // Esto evita ejecutarse en el mount inicial cuando refreshTrigger es 0
    if (!refreshTrigger || refreshTrigger <= 0) {
      logger.debug('refreshTrigger no válido, saltando verificación', { refreshTrigger }, 'contract')
      return
    }
    
    logger.info('🔄 Forzando recarga de polls después de crear nueva poll', { 
      refreshTrigger,
      queryAddress 
    }, 'contract')
    
    // Función para obtener el total actual de polls
    const getCurrentTotal = async (): Promise<number> => {
      try {
        const total = await getTotalPolls()
        return total
      } catch (e) {
        logger.warning('Error obteniendo total de polls', { error: e }, 'contract')
        return 0
      }
    }
    
    let checkInterval: NodeJS.Timeout | null = null
    let timeoutId: NodeJS.Timeout | null = null
    
    // Esperar inicialmente 3 segundos para que la transacción se procese
    timeoutId = setTimeout(async () => {
      let attempts = 0
      const maxAttempts = 20 // Más intentos (40 segundos total)
      let previousTotalPolls = await getCurrentTotal()
      
      logger.debug('Iniciando verificación de nueva poll', { 
        previousTotalPolls,
        refreshTrigger 
      }, 'contract')
      
      checkInterval = setInterval(async () => {
        attempts++
        const currentTotal = await getCurrentTotal()
        
        logger.debug(`Intento ${attempts}/${maxAttempts} verificando nueva poll`, { 
          attempts, 
          previousTotalPolls, 
          currentTotal,
          increased: currentTotal > previousTotalPolls
        }, 'contract')
        
        // Si el total aumentó, la transacción se confirmó
        if (currentTotal > previousTotalPolls) {
          logger.success('✅ Nueva poll detectada! Recargando lista completa...', { 
            previousTotal: previousTotalPolls, 
            newTotal: currentTotal,
            attempts
          }, 'contract')
          previousTotalPolls = currentTotal
          // Recargar la lista completa
          await loadPolls()
          if (checkInterval) clearInterval(checkInterval)
        } else if (attempts >= maxAttempts) {
          // Si alcanzamos el máximo de intentos, recargar de todas formas
          logger.info('Alcanzado máximo de intentos, recargando polls de todas formas', { 
            attempts,
            previousTotal: previousTotalPolls,
            currentTotal
          }, 'contract')
          await loadPolls()
          if (checkInterval) clearInterval(checkInterval)
        } else {
          // Si aún no se confirmó, recargar para mantener datos actualizados
          // pero continuar verificando
          if (attempts % 3 === 0) { // Recargar cada 3 intentos para no saturar
            await loadPolls()
          }
        }
      }, 2000) // Intentar cada 2 segundos
    }, 3000) // Esperar 3 segundos antes de empezar a verificar
    
    // Cleanup
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (checkInterval) clearInterval(checkInterval)
    }
  }, [refreshTrigger, queryAddress])

  const loadPolls = async () => {
    if (!queryAddress) {
      logger.debug('Esperando dirección de query...', null, 'api')
      return
    }
    
    try {
      setError(null)
      logger.info('Cargando polls desde el contrato...', null, 'contract')
      const totalPolls = await getTotalPolls()
      logger.info(`Total de polls encontrados: ${totalPolls}`, { totalPolls }, 'contract')
      const pollsData: Poll[] = []

      for (let i = 1; i <= totalPolls; i++) {
        logger.debug(`Cargando poll #${i}...`, { pollId: i }, 'contract')
        const poll = await getPoll(i)
        logger.debug(`Poll #${i} cargado`, { exists: poll.exists, poll }, 'contract')
        if (poll.exists && poll.id && poll.title && poll.description !== undefined) {
          // Obtener metadata completa del contrato (fuente de verdad)
          let contractPollData = null
          try {
            contractPollData = await getPollMetadataFromContract(contract, poll.id, queryAddress)
            if (contractPollData) {
              // Sincronizar con la BD local para combinar datos
              await syncPollMetadata(contract, poll.id, queryAddress)
            }
          } catch (e) {
            logger.warning(`Error obteniendo metadata del contrato para poll ${poll.id}`, { error: e }, 'contract')
          }

          // Obtener metadata de la BD local (nombres de opciones y otros datos adicionales)
          let optionNames: string[] | undefined = undefined
          let metadataTitle = contractPollData?.title || poll.title
          let metadataDescription = contractPollData?.description || poll.description
          let metadataEndsAt = contractPollData?.endsAt || poll.endsAt
          let metadataMaxOptions = contractPollData?.maxOptions || poll.maxOptions
          let metadataTotalVotes = contractPollData?.totalVotes ?? poll.totalVotes
          let metadataIsActive = contractPollData?.isActive ?? poll.isActive
          let metadataCreatedAt = contractPollData?.createdAt || poll.createdAt
          let metadataVoteTallies = contractPollData?.voteTallies || poll.voteTallies
          
          try {
            const metadata = await getPollMetadata(poll.id)
            if (metadata) {
              // Usar datos de la BD local para campos adicionales (optionNames, duration)
              if (metadata.optionNames && metadata.optionNames.length > 0) {
                optionNames = metadata.optionNames
              }
              // Los datos del contrato tienen prioridad, pero podemos usar la BD local como fallback
              if (!metadataTitle && metadata.title) metadataTitle = metadata.title
              if (!metadataDescription && metadata.description) metadataDescription = metadata.description
            }
          } catch (e) {
            logger.warning(`Error obteniendo metadata para poll ${poll.id}`, { error: e }, 'database')
          }

          pollsData.push({
            id: poll.id,
            title: metadataTitle,
            description: metadataDescription,
            maxOptions: metadataMaxOptions || 0,
            totalVotes: metadataTotalVotes || 0,
            isActive: metadataIsActive || false,
            creator: contractPollData?.creator || poll.creator || '',
            createdAt: metadataCreatedAt || 0,
            endsAt: metadataEndsAt || 0,
            voteTallies: metadataVoteTallies || [],
            optionNames
          })
        }
      }

      setPolls(pollsData)
      logger.success(`${pollsData.length} polls cargados exitosamente`, { count: pollsData.length }, 'contract')
    } catch (err: any) {
      logger.error('Error cargando polls', { message: err.message, stack: err.stack }, 'contract')
      setError(`Error al cargar las encuestas: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const getTotalPolls = async (): Promise<number> => {
    if (!queryAddress) return 0
    
    try {
      const gasLimit = contract.abi.registry.createType('WeightV2', {
        refTime: 100000000000,
        proofSize: 1000000
      }) as any
      
      logger.debug('Consultando getTotalPolls', { address: queryAddress }, 'contract')
      const result = await contract.query.getTotalPolls(
        queryAddress,
        { value: 0, gasLimit }
      )
      // Log detallado del resultado completo
      logger.debug('Resultado completo de getTotalPolls', { 
        result,
        hasOutput: !!result.output,
        outputType: typeof result.output,
        outputKeys: result.output && typeof result.output === 'object' ? Object.keys(result.output) : null
      }, 'contract')
      
      // El resultado puede venir en diferentes lugares según la versión de Polkadot.js
      let output = result.output
      if (!output && (result as any).result?.output) {
        output = (result as any).result.output
      }
      
      // Intentar múltiples formas de parsear el resultado
      let total = 0
      
      // PRIORIDAD 1: Intentar toHuman() primero (más confiable)
      let humanOutput: any = null
      try {
        if (output && typeof output === 'object' && 'toHuman' in output) {
          humanOutput = (output as any).toHuman()
          logger.debug('Output convertido a human', { humanOutput }, 'contract')
          
          // Parsear desde humanOutput
          if (humanOutput && typeof humanOutput === 'object') {
            // Buscar Ok (mayúscula) primero
            if ('Ok' in humanOutput) {
              const okValue = humanOutput.Ok
              if (typeof okValue === 'string') {
                total = Number(okValue) || 0
              } else if (typeof okValue === 'number') {
                total = okValue
              } else if (okValue && typeof okValue === 'object' && 'toNumber' in okValue) {
                total = (okValue as any).toNumber() || 0
              }
              logger.debug('Parseado desde human usando Ok', { total, okValue }, 'contract')
            }
            // Buscar ok (minúscula)
            else if ('ok' in humanOutput) {
              const okValue = humanOutput.ok
              if (typeof okValue === 'string') {
                total = Number(okValue) || 0
              } else if (typeof okValue === 'number') {
                total = okValue
              } else if (okValue && typeof okValue === 'object' && 'toNumber' in okValue) {
                total = (okValue as any).toNumber() || 0
              }
              logger.debug('Parseado desde human usando ok', { total, okValue }, 'contract')
            }
            // Si humanOutput es directamente un número
            else if (typeof humanOutput === 'number') {
              total = humanOutput
              logger.debug('Parseado desde human como número directo', { total }, 'contract')
            }
            // Intentar extraer el número de cualquier propiedad
            else {
              const values = Object.values(humanOutput)
              for (const val of values) {
                if (typeof val === 'number') {
                  total = val
                  logger.debug('Parseado desde valores del objeto human', { total }, 'contract')
                  break
                } else if (typeof val === 'string' && !isNaN(Number(val))) {
                  total = Number(val)
                  logger.debug('Parseado desde string en valores del objeto human', { total }, 'contract')
                  break
                }
              }
            }
          } else if (typeof humanOutput === 'number') {
            total = humanOutput
            logger.debug('Parseado desde human como número', { total }, 'contract')
          }
        }
      } catch (e) {
        logger.warning('Error al convertir output a human', { error: e }, 'contract')
      }
      
      // PRIORIDAD 2: Si no se pudo parsear desde human, intentar métodos directos
      if (total === 0 && output) {
        // Método 1: Si viene como { ok: number } (formato JSON serializado)
        if (typeof output === 'object' && 'ok' in output) {
          const okValue = (output as any).ok
          if (typeof okValue === 'number') {
            total = okValue
            logger.debug('Parseado usando ok (lowercase) directo', { total }, 'contract')
          } else if (typeof okValue === 'object' && 'toNumber' in okValue) {
            total = (okValue as any).toNumber() || 0
            logger.debug('Parseado usando ok.toNumber()', { total }, 'contract')
          }
        }
        // Método 2: Si viene como { Ok: number } (formato SCALE)
        else if (typeof output === 'object' && 'Ok' in output) {
          const okValue = (output as any).Ok
          if (typeof okValue === 'number') {
            total = okValue
            logger.debug('Parseado usando Ok (uppercase) directo', { total }, 'contract')
          } else if (typeof okValue === 'object' && 'toNumber' in okValue) {
            total = okValue.toNumber() || 0
            logger.debug('Parseado usando Ok.toNumber()', { total }, 'contract')
          }
        }
        // Método 3: Si tiene toNumber() directamente (solo si devuelve un valor válido)
        else if (typeof output === 'object' && 'toNumber' in output) {
          const numValue = (output as any).toNumber()
          if (numValue > 0) {
            total = numValue
            logger.debug('Parseado usando toNumber()', { total }, 'contract')
          }
        }
        // Método 4: Si es un número directamente
        else if (typeof output === 'number') {
          total = output
          logger.debug('Parseado como número directo', { total }, 'contract')
        }
      }
      
      if (total > 0) {
        logger.info(`Total de polls: ${total}`, { total, outputType: typeof output }, 'contract')
        return total
      }
      
      logger.warning('No se pudo extraer total de polls del output', { 
        output, 
        outputType: typeof output,
        hasToNumber: output && typeof output === 'object' && 'toNumber' in output,
        hasOk: output && typeof output === 'object' && 'ok' in output,
        hasOkUpper: output && typeof output === 'object' && 'Ok' in output
      }, 'contract')
      return 0
    } catch (error: any) {
      console.error('❌ Error obteniendo total de polls:', error.message)
      console.error('   - Stack:', error.stack)
      return 0
    }
  }

  const getVoteTallies = async (pollId: number): Promise<number[]> => {
    try {
      const gasLimit = contract.abi.registry.createType('WeightV2', {
        refTime: 100000000000,
        proofSize: 1000000
      }) as any
      
      if (!queryAddress) return []
      
      const result = await contract.query.getAllTallies(
        queryAddress,
        { value: 0, gasLimit },
        pollId
      )
      
      const output = result.output?.toHuman() as any
      if (!output || !output.Ok) return []
      
      // getAllTallies devuelve un Vec<u32>
      const tallies = output.Ok
      if (Array.isArray(tallies)) {
        return tallies.map((t: any) => Number(t || 0))
      }
      return []
    } catch (error: any) {
      console.warn(`Error obteniendo tallies para poll ${pollId}:`, error.message)
      return []
    }
  }

  const getPoll = async (pollId: number) => {
    if (!queryAddress) {
      return { exists: false }
    }
    
    try {
      const gasLimit = contract.abi.registry.createType('WeightV2', {
        refTime: 100000000000,
        proofSize: 1000000
      }) as any
      
      logger.debug(`Consultando getPoll(${pollId})`, { pollId, address: queryAddress }, 'contract')
      const result = await contract.query.getPoll(
        queryAddress,
        { value: 0, gasLimit },
        pollId
      )
      logger.debug(`Resultado de getPoll(${pollId})`, { pollId, result }, 'contract')
      
      const output = result.output?.toHuman() as any
      if (!output || !output.Ok) return { exists: false }

      // get_poll devuelve: (exists, id, title, description, merkleRoot, maxOptions, creator, isActive, totalVotes, created_at, ends_at)
      const [exists, id, title, description, merkleRoot, maxOptions, creator, isActive, totalVotes, createdAt, endsAt] = output.Ok
      
      // El creator puede venir como AccountId32, necesitamos manejarlo correctamente
      let creatorAddress = ''
      try {
        if (creator) {
          // Si creator es un objeto con estructura de AccountId, extraer la dirección
          if (typeof creator === 'object' && creator !== null) {
            // Puede venir como { AccountId32: "..." } o similar
            creatorAddress = Object.values(creator)[0] as string || String(creator)
          } else {
            creatorAddress = String(creator)
          }
        }
      } catch (e) {
        console.warn('Error procesando creator:', e)
        creatorAddress = String(creator || '')
      }
      
      const pollIdNum = Number(id || 0)
      
      // Obtener los tallies (votos por opción)
      let voteTallies: number[] = []
      try {
        voteTallies = await getVoteTallies(pollIdNum)
      } catch (e) {
        console.warn(`Error obteniendo tallies para poll ${pollIdNum}:`, e)
        // Si falla, crear array vacío
        voteTallies = Array(Number(maxOptions || 0)).fill(0)
      }
      
      return {
        exists: exists === true,
        id: pollIdNum,
        title: String(title || ''),
        description: String(description || ''),
        merkleRoot: String(merkleRoot || ''),
        maxOptions: Number(maxOptions || 0),
        creator: creatorAddress,
        isActive: isActive === true,
        totalVotes: Number(totalVotes || 0),
        createdAt: Number(createdAt || 0),
        endsAt: Number(endsAt || 0),
        voteTallies
      }
    } catch (error: any) {
      // Si hay un error de AccountId (20 vs 32 bytes), simplemente retornar que no existe
      // Esto puede pasar si hay datos inconsistentes en el contrato
      if (error.message?.includes('AccountId') || error.message?.includes('32 bytes')) {
        console.warn(`Error al cargar poll:`, error.message)
        return { exists: false }
      }
      throw error
    }
  }

  if (!queryAddress) {
    return <div className="poll-list-loading">Inicializando conexión...</div>
  }

  if (loading) {
    return <div className="poll-list-loading">Cargando encuestas...</div>
  }

  if (error) {
    return <div className="poll-list-error">{error}</div>
  }

  if (polls.length === 0) {
    return (
      <div className="poll-list-empty">
        <h2>No hay encuestas disponibles</h2>
        <p>Crea tu primera encuesta usando el botón de arriba</p>
      </div>
    )
  }

  const formatTimeRemaining = (endsAt: number): string => {
    if (endsAt === 0) return 'Sin límite'
    
    const now = Date.now()
    const endTime = endsAt // endsAt está en milisegundos según el contrato
    const remaining = endTime - now
    
    if (remaining <= 0) return 'Finalizada'
    
    const seconds = Math.floor(remaining / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days}d ${hours % 24}h`
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  const formatDate = (timestamp: number): string => {
    if (timestamp === 0) return 'N/A'
    const date = new Date(timestamp)
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="poll-list">
      <h2>Encuestas Disponibles ({polls.length})</h2>
      <div className="polls-grid">
        {polls.map((poll) => (
          <div key={poll.id} className="poll-card">
            <div className="poll-header">
              <h3>{poll.title}</h3>
              <span className={`poll-status ${poll.isActive ? 'active' : 'inactive'}`}>
                {poll.isActive ? 'Activa' : 'Cerrada'}
              </span>
            </div>
            <p className="poll-description">{poll.description}</p>
            
            {/* Tiempo restante */}
            {poll.isActive && poll.endsAt > 0 && (
              <div className="poll-time">
                <span className="time-label">⏱️ Tiempo restante:</span>
                <span className="time-value">{formatTimeRemaining(poll.endsAt)}</span>
              </div>
            )}
            
            {/* Opciones y votos */}
            <div className="poll-options">
              <h4>Opciones de Votación:</h4>
              <div className="options-list">
                {Array.from({ length: poll.maxOptions }, (_, i) => {
                  const optionName = poll.optionNames && poll.optionNames[i] 
                    ? poll.optionNames[i] 
                    : `Opción ${i + 1}`
                  return (
                  <div key={i} className="option-item">
                    <div className="option-label">
                      <span className="option-number">{i + 1}</span>
                      <span className="option-name">{optionName}</span>
                    </div>
                    <div className="option-votes">
                      <span className="vote-count">{poll.voteTallies[i] || 0}</span>
                      <span className="vote-label">votos</span>
                      {poll.totalVotes > 0 && (
                        <span className="vote-percentage">
                          ({Math.round(((poll.voteTallies[i] || 0) / poll.totalVotes) * 100)}%)
                        </span>
                      )}
                    </div>
                    {poll.totalVotes > 0 && (
                      <div className="vote-bar">
                        <div 
                          className="vote-bar-fill"
                          style={{ 
                            width: `${((poll.voteTallies[i] || 0) / poll.totalVotes) * 100}%` 
                          }}
                        />
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>
            </div>
            
            <div className="poll-info">
              <div className="poll-stat">
                <span className="stat-label">Total de votos:</span>
                <span className="stat-value">{poll.totalVotes}</span>
              </div>
              {poll.createdAt > 0 && (
                <div className="poll-stat">
                  <span className="stat-label">Creada:</span>
                  <span className="stat-value">{formatDate(poll.createdAt)}</span>
                </div>
              )}
            </div>
            {poll.isActive && (
              <button 
                className="btn-vote"
                onClick={() => onVoteClick(poll.id)}
              >
                🗳️ Votar
              </button>
            )}
            <div className="poll-footer">
              <small>ID: {poll.id} | Creador: {poll.creator.slice(0, 10)}...</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

