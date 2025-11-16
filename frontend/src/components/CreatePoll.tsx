import { useState, useEffect } from 'react'
import { ContractPromise } from '@polkadot/api-contract'
import { ApiPromise } from '@polkadot/api'
import { AccountInfo } from '../utils/polkadot'
import { savePollMetadata } from '../utils/database'
import { NODE_CONFIGS, NodeType } from '../config'
import './CreatePoll.css'

interface CreatePollProps {
  contract: ContractPromise
  api: ApiPromise | null
  selectedAccount: AccountInfo | null
  nodeType?: NodeType
  onClose: () => void
}

export default function CreatePoll({ contract, api, selectedAccount, nodeType = 'ink-local', onClose }: CreatePollProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [maxOptions, setMaxOptions] = useState(2)
  const [optionNames, setOptionNames] = useState<string[]>(['Opción 1', 'Opción 2'])
  const [duration, setDuration] = useState(86400) // 1 día en segundos
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Actualizar optionNames cuando cambia maxOptions
  useEffect(() => {
    const newOptions = Array.from({ length: maxOptions }, (_, i) => {
      // Mantener nombres existentes si están dentro del rango
      return optionNames[i] || `Opción ${i + 1}`
    })
    setOptionNames(newOptions)
  }, [maxOptions])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    // Verificar si el contrato está deployado en esta red
    const nodeConfig = NODE_CONFIGS[nodeType]
    if (!nodeConfig.contractDeployed) {
      setError(`⚠️ El contrato no está deployado en ${nodeConfig.name}. Por favor, usa la red local (ink-node) para crear polls.`)
      setLoading(false)
      return
    }

    try {
      // Merkle root temporal (en producción se calcularía correctamente)
      const merkleRoot = '0x' + '01'.repeat(32)

      const gasLimit = contract.abi.registry.createType('WeightV2', {
        refTime: 200000000000,
        proofSize: 2000000
      }) as any

      const result = await contract.tx.createPoll(
        {
          value: 0,
          gasLimit
        },
        title,
        description,
        merkleRoot,
        maxOptions,
        duration
      )

      if (!selectedAccount) {
        setError('Por favor, selecciona una cuenta primero')
        setLoading(false)
        return
      }

      // Obtener metadata de la cadena antes de enviar
      let chainMetadata = null
      let blockNumber = 0
      let blockHash = ''
      let transactionHash = ''
      
      if (api) {
        try {
          const [chainName, chainId, runtimeVersion] = await Promise.all([
            api.rpc.system.chain(),
            api.rpc.system.properties(),
            api.runtimeVersion
          ])
          
          chainMetadata = {
            chainName: chainName.toString(),
            chainId: chainId.ss58Format?.toString() || '0',
            specVersion: runtimeVersion.specVersion.toString()
          }
        } catch (e) {
          console.warn('Error obteniendo metadata de cadena:', e)
        }
      }

      // Para cuentas de desarrollo, pasar el par directamente
      // Para cuentas de extensión, pasar la dirección (el signer ya está configurado)
      if (selectedAccount.isDevAccount) {
        const { getPairForAddress } = await import('../utils/polkadot')
        const pair = await getPairForAddress(selectedAccount.address)
        await result.signAndSend(pair, async (result: any) => {
          if (result.status.isInBlock || result.status.isFinalized) {
            // Obtener información del bloque
            if (result.status.isInBlock && api) {
              try {
                const blockHashObj = result.status.asInBlock
                // Obtener el bloque completo para extraer el número
                const block = await api.rpc.chain.getBlock(blockHashObj)
                blockNumber = block.block.header.number.toNumber()
                blockHash = block.block.header.hash.toHex()
                transactionHash = result.txHash.toHex()
              } catch (e) {
                console.warn('Error obteniendo información del bloque:', e)
                // Si falla, al menos guardar el hash de la transacción
                transactionHash = result.txHash.toHex()
              }
            }
            
            // Logging detallado de eventos del contrato
            console.log('📋 Eventos de la transacción:', result.events)
            console.log('📦 Resultado completo:', JSON.stringify(result, null, 2))
            
            // Extraer pollId del resultado (si está disponible)
            let pollId = 0
            try {
              // Intentar obtener el pollId del evento o del resultado
              if (result.events) {
                console.log(`🔍 Analizando ${result.events.length} eventos...`)
                for (const eventRecord of result.events) {
                  console.log('📨 Evento completo:', eventRecord)
                  
                  // Los eventos de Ink! pueden venir en diferentes formatos
                  // Intentar decodificar usando el ABI del contrato
                  if (contract && eventRecord.event) {
                    try {
                      // El evento puede estar en eventRecord.event
                      const event = eventRecord.event
                      console.log('📋 Estructura del evento:', {
                        section: event.section,
                        method: event.method,
                        data: event.data,
                        index: eventRecord.phase
                      })
                      
                      // Buscar el evento PollCreated por su signature_topic o identifier
                      // El signature_topic es: 0x315d56ae591770f851cb2b9248304a695ce876d893ba1b8422a266d8eb9d5208
                      const isPollCreated = 
                        event.section === 'contracts' && 
                        (event.method === 'ContractEmitted' || event.method === 'ContractExecution')
                      
                      if (isPollCreated || event.method === 'PollCreated') {
                        try {
                          // Intentar decodificar el evento usando el ABI
                          const decoded = contract.abi.decodeEvent(eventRecord)
                          console.log('✅ Evento decodificado:', decoded)
                          
                          if (decoded && decoded.event && decoded.event.identifier === 'PollCreated') {
                            const args = decoded.args || []
                            if (args.length > 0) {
                              pollId = Number(args[0]) || 0
                              console.log(`✅ PollId extraído del evento decodificado: ${pollId}`)
                              break
                            }
                          }
                        } catch (decodeError) {
                          console.warn('⚠️ Error decodificando evento con ABI:', decodeError)
                        }
                        
                        // Fallback: buscar en los datos del evento
                        if (pollId === 0 && event.data) {
                          // Los eventos de Ink! emiten datos como ContractEmitted
                          // El primer topic suele ser el signature_topic del evento
                          // Y los siguientes topics son los argumentos indexados
                          const topics = (event.data as any).topics || []
                          const data = (event.data as any).data
                          
                          console.log('📊 Topics del evento:', topics)
                          console.log('📊 Data del evento:', data)
                          
                          // El poll_id es el primer argumento indexado (después del signature_topic)
                          // Buscar en los topics (el primero es el signature, el segundo puede ser el poll_id)
                          if (topics.length > 1) {
                            try {
                              // El segundo topic debería ser el poll_id (u128)
                              const pollIdTopic = topics[1]
                              if (pollIdTopic) {
                                // Convertir de hex a número
                                pollId = Number(pollIdTopic) || parseInt(pollIdTopic.toString().replace('0x', ''), 16) || 0
                                if (pollId > 0) {
                                  console.log(`✅ PollId extraído de topic: ${pollId}`)
                                  break
                                }
                              }
                            } catch (e) {
                              console.warn('Error extrayendo pollId de topic:', e)
                            }
                          }
                        }
                      }
                    } catch (decodeError) {
                      console.warn('⚠️ Error procesando evento:', decodeError)
                    }
                  }
                  
                  // Fallback adicional: buscar por identifier o method
                  if (pollId === 0 && eventRecord.event) {
                    const event = eventRecord.event
                    const eventIdentifier = event.method || (event as any).identifier
                    console.log('🔍 Buscando evento por identifier:', eventIdentifier)
                    
                    if (eventIdentifier === 'PollCreated' || eventIdentifier === 'ContractEmitted') {
                      const eventData = event.data
                      console.log('📊 Datos del evento (fallback):', eventData)
                      
                      // Intentar extraer de diferentes estructuras
                      if (eventData) {
                        if (Array.isArray(eventData) && eventData.length > 0) {
                          pollId = Number(eventData[0]) || 0
                          if (pollId > 0) {
                            console.log(`✅ PollId extraído de array: ${pollId}`)
                            break
                          }
                        } else if (typeof eventData === 'object') {
                          // Buscar en propiedades del objeto
                          const dataObj = eventData as any
                          if (dataObj.topics && Array.isArray(dataObj.topics) && dataObj.topics.length > 1) {
                            try {
                              pollId = Number(dataObj.topics[1]) || parseInt(dataObj.topics[1].toString().replace('0x', ''), 16) || 0
                              if (pollId > 0) {
                                console.log(`✅ PollId extraído de data.topics: ${pollId}`)
                                break
                              }
                            } catch (e) {
                              console.warn('Error extrayendo de data.topics:', e)
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('⚠️ Error extrayendo pollId del evento:', e)
            }

            // Si no pudimos obtener el pollId del evento, intentar obtenerlo del total de polls
            // Esto es menos confiable pero puede funcionar si solo hay una transacción
            if (pollId === 0 && contract) {
              try {
                console.log('🔄 Intentando obtener pollId del total de polls...')
                const gasLimit = contract.abi.registry.createType('WeightV2', {
                  refTime: 100000000000,
                  proofSize: 1000000
                }) as any
                const totalResult = await contract.query.getTotalPolls(
                  contract.address,
                  { value: 0, gasLimit }
                )
                const output = totalResult.output
                console.log('📊 Total de polls obtenido:', output)
                if (output && typeof output === 'object' && 'toNumber' in output) {
                  pollId = (output as any).toNumber()
                  console.log(`✅ PollId obtenido del total de polls: ${pollId}`)
                }
              } catch (e) {
                console.warn('Error obteniendo pollId del total:', e)
              }
            }

            // Guardar metadata en la base de datos local
            if (pollId > 0) {
              try {
                // Calcular endsAt basado en la duración
                const createdAt = Date.now()
                const endsAt = duration > 0 ? createdAt + (duration * 1000) : 0
                
                console.log('💾 Guardando metadata en base de datos local...')
                console.log('📊 Metadata completa:', {
                  pollId,
                  title,
                  description,
                  optionNames: optionNames.slice(0, maxOptions),
                  maxOptions,
                  duration,
                  endsAt,
                  createdAt,
                  blockNumber,
                  blockHash,
                  transactionHash,
                  chainMetadata
                })
                
                await savePollMetadata({
                  pollId,
                  title,
                  description,
                  optionNames: optionNames.slice(0, maxOptions),
                  maxOptions,
                  duration,
                  endsAt,
                  createdAt,
                  blockNumber: blockNumber || undefined,
                  blockHash: blockHash || undefined,
                  transactionHash: transactionHash || undefined,
                  chainMetadata: chainMetadata || undefined
                })
                
                console.log('✅ Metadata guardada exitosamente en IndexedDB')
              } catch (e) {
                console.error('❌ Error guardando metadata en BD local:', e)
              }
            } else {
              console.warn('⚠️ No se pudo obtener pollId, no se guardará metadata')
            }

            setLoading(false)
            setSuccess(true)
            setTimeout(() => {
              onClose()
              window.location.reload()
            }, 2000)
          }
        })
      } else {
        await result.signAndSend(selectedAccount.address, async (result: any) => {
          if (result.status.isInBlock || result.status.isFinalized) {
            // Obtener información del bloque
            if (result.status.isInBlock && api) {
              try {
                const blockHashObj = result.status.asInBlock
                // Obtener el bloque completo para extraer el número
                const block = await api.rpc.chain.getBlock(blockHashObj)
                blockNumber = block.block.header.number.toNumber()
                blockHash = block.block.header.hash.toHex()
                transactionHash = result.txHash.toHex()
              } catch (e) {
                console.warn('Error obteniendo información del bloque:', e)
                // Si falla, al menos guardar el hash de la transacción
                transactionHash = result.txHash.toHex()
              }
            }
            
            // Logging detallado de eventos del contrato
            console.log('📋 Eventos de la transacción:', result.events)
            console.log('📦 Resultado completo:', JSON.stringify(result, null, 2))
            
            // Extraer pollId del resultado
            let pollId = 0
            try {
              // Intentar obtener el pollId del evento o del resultado
              if (result.events) {
                console.log(`🔍 Analizando ${result.events.length} eventos...`)
                for (const eventRecord of result.events) {
                  console.log('📨 Evento completo:', eventRecord)
                  
                  // Los eventos de Ink! pueden venir en diferentes formatos
                  // Intentar decodificar usando el ABI del contrato
                  if (contract && eventRecord.event) {
                    try {
                      // El evento puede estar en eventRecord.event
                      const event = eventRecord.event
                      console.log('📋 Estructura del evento:', {
                        section: event.section,
                        method: event.method,
                        data: event.data,
                        index: eventRecord.phase
                      })
                      
                      // Buscar el evento PollCreated por su signature_topic o identifier
                      // El signature_topic es: 0x315d56ae591770f851cb2b9248304a695ce876d893ba1b8422a266d8eb9d5208
                      const isPollCreated = 
                        event.section === 'contracts' && 
                        (event.method === 'ContractEmitted' || event.method === 'ContractExecution')
                      
                      if (isPollCreated || event.method === 'PollCreated') {
                        try {
                          // Intentar decodificar el evento usando el ABI
                          const decoded = contract.abi.decodeEvent(eventRecord)
                          console.log('✅ Evento decodificado:', decoded)
                          
                          if (decoded && decoded.event && decoded.event.identifier === 'PollCreated') {
                            const args = decoded.args || []
                            if (args.length > 0) {
                              pollId = Number(args[0]) || 0
                              console.log(`✅ PollId extraído del evento decodificado: ${pollId}`)
                              break
                            }
                          }
                        } catch (decodeError) {
                          console.warn('⚠️ Error decodificando evento con ABI:', decodeError)
                        }
                        
                        // Fallback: buscar en los datos del evento
                        if (pollId === 0 && event.data) {
                          // Los eventos de Ink! emiten datos como ContractEmitted
                          // El primer topic suele ser el signature_topic del evento
                          // Y los siguientes topics son los argumentos indexados
                          const topics = (event.data as any).topics || []
                          const data = (event.data as any).data
                          
                          console.log('📊 Topics del evento:', topics)
                          console.log('📊 Data del evento:', data)
                          
                          // El poll_id es el primer argumento indexado (después del signature_topic)
                          // Buscar en los topics (el primero es el signature, el segundo puede ser el poll_id)
                          if (topics.length > 1) {
                            try {
                              // El segundo topic debería ser el poll_id (u128)
                              const pollIdTopic = topics[1]
                              if (pollIdTopic) {
                                // Convertir de hex a número
                                pollId = Number(pollIdTopic) || parseInt(pollIdTopic.toString().replace('0x', ''), 16) || 0
                                if (pollId > 0) {
                                  console.log(`✅ PollId extraído de topic: ${pollId}`)
                                  break
                                }
                              }
                            } catch (e) {
                              console.warn('Error extrayendo pollId de topic:', e)
                            }
                          }
                        }
                      }
                    } catch (decodeError) {
                      console.warn('⚠️ Error procesando evento:', decodeError)
                    }
                  }
                  
                  // Fallback adicional: buscar por identifier o method
                  if (pollId === 0 && eventRecord.event) {
                    const event = eventRecord.event
                    const eventIdentifier = event.method || (event as any).identifier
                    console.log('🔍 Buscando evento por identifier:', eventIdentifier)
                    
                    if (eventIdentifier === 'PollCreated' || eventIdentifier === 'ContractEmitted') {
                      const eventData = event.data
                      console.log('📊 Datos del evento (fallback):', eventData)
                      
                      // Intentar extraer de diferentes estructuras
                      if (eventData) {
                        if (Array.isArray(eventData) && eventData.length > 0) {
                          pollId = Number(eventData[0]) || 0
                          if (pollId > 0) {
                            console.log(`✅ PollId extraído de array: ${pollId}`)
                            break
                          }
                        } else if (typeof eventData === 'object') {
                          // Buscar en propiedades del objeto
                          const dataObj = eventData as any
                          if (dataObj.topics && Array.isArray(dataObj.topics) && dataObj.topics.length > 1) {
                            try {
                              pollId = Number(dataObj.topics[1]) || parseInt(dataObj.topics[1].toString().replace('0x', ''), 16) || 0
                              if (pollId > 0) {
                                console.log(`✅ PollId extraído de data.topics: ${pollId}`)
                                break
                              }
                            } catch (e) {
                              console.warn('Error extrayendo de data.topics:', e)
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('⚠️ Error extrayendo pollId del evento:', e)
            }

            // Si no pudimos obtener el pollId del evento, intentar obtenerlo del total de polls
            // Esto es menos confiable pero puede funcionar si solo hay una transacción
            if (pollId === 0 && contract) {
              try {
                console.log('🔄 Intentando obtener pollId del total de polls...')
                const gasLimit = contract.abi.registry.createType('WeightV2', {
                  refTime: 100000000000,
                  proofSize: 1000000
                }) as any
                const totalResult = await contract.query.getTotalPolls(
                  contract.address,
                  { value: 0, gasLimit }
                )
                const output = totalResult.output
                console.log('📊 Total de polls obtenido:', output)
                if (output && typeof output === 'object' && 'toNumber' in output) {
                  pollId = (output as any).toNumber()
                  console.log(`✅ PollId obtenido del total de polls: ${pollId}`)
                }
              } catch (e) {
                console.warn('Error obteniendo pollId del total:', e)
              }
            }

            // Guardar metadata en la base de datos local
            if (pollId > 0) {
              try {
                // Calcular endsAt basado en la duración
                const createdAt = Date.now()
                const endsAt = duration > 0 ? createdAt + (duration * 1000) : 0
                
                console.log('💾 Guardando metadata en base de datos local...')
                console.log('📊 Metadata completa:', {
                  pollId,
                  title,
                  description,
                  optionNames: optionNames.slice(0, maxOptions),
                  maxOptions,
                  duration,
                  endsAt,
                  createdAt,
                  blockNumber,
                  blockHash,
                  transactionHash,
                  chainMetadata
                })
                
                await savePollMetadata({
                  pollId,
                  title,
                  description,
                  optionNames: optionNames.slice(0, maxOptions),
                  maxOptions,
                  duration,
                  endsAt,
                  createdAt,
                  blockNumber: blockNumber || undefined,
                  blockHash: blockHash || undefined,
                  transactionHash: transactionHash || undefined,
                  chainMetadata: chainMetadata || undefined
                })
                
                console.log('✅ Metadata guardada exitosamente en IndexedDB')
              } catch (e) {
                console.error('❌ Error guardando metadata en BD local:', e)
              }
            } else {
              console.warn('⚠️ No se pudo obtener pollId, no se guardará metadata')
            }

            setLoading(false)
            setSuccess(true)
            setTimeout(() => {
              onClose()
              window.location.reload()
            }, 2000)
          }
        })
      }
    } catch (err: any) {
      console.error('Error creando poll:', err)
      let errorMessage = err.message || 'Error al crear la encuesta'
      
      // Mensajes de error más claros
      if (errorMessage.includes('1010') || errorMessage.includes('Inability to pay')) {
        errorMessage = `⚠️ No se pueden pagar las fees. ${nodeConfig.contractDeployed ? 'Asegúrate de tener fondos suficientes.' : `El contrato no está deployado en ${nodeConfig.name}. Usa la red local (ink-node) para crear polls.`}`
      } else if (errorMessage.includes('Invalid Transaction')) {
        errorMessage = `⚠️ Transacción inválida. ${nodeConfig.contractDeployed ? 'Verifica que la cuenta tenga fondos suficientes.' : `El contrato no está deployado en ${nodeConfig.name}. Usa la red local (ink-node) para crear polls.`}`
      }
      
      setError(errorMessage)
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Crear Nueva Encuesta</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="create-poll-form">
          <div className="form-group">
            <label>Título de la Encuesta</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={100}
              placeholder="Ej: ¿Cuál es tu lenguaje de programación favorito?"
            />
          </div>

          <div className="form-group">
            <label>Descripción</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              maxLength={500}
              rows={4}
              placeholder="Describe tu encuesta..."
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Número de Opciones</label>
              <input
                type="number"
                value={maxOptions}
                onChange={(e) => {
                  const newMax = parseInt(e.target.value) || 2
                  setMaxOptions(newMax)
                }}
                min={2}
                max={100}
                required
              />
            </div>

            <div className="form-group">
              <label>Duración (segundos)</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 86400)}
                min={0}
                placeholder="0 = sin límite"
              />
              <small>{duration > 0 ? `${Math.floor(duration / 3600)} horas` : 'Sin límite'}</small>
            </div>
          </div>

          <div className="form-group">
            <label>Nombres de las Opciones</label>
            <div className="options-input-list">
              {optionNames.map((name, index) => (
                <div key={index} className="option-input-item">
                  <span className="option-input-number">{index + 1}</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                      const newNames = [...optionNames]
                      newNames[index] = e.target.value
                      setOptionNames(newNames)
                    }}
                    placeholder={`Nombre de la opción ${index + 1}`}
                    maxLength={50}
                    required
                  />
                </div>
              ))}
            </div>
            <small>Define un nombre descriptivo para cada opción de votación</small>
          </div>

          {error && <div className="form-error">{error}</div>}
          {success && <div className="form-success">¡Encuesta creada exitosamente!</div>}

          <div className="form-actions">
            <button type="button" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button type="submit" disabled={loading || !title || !description}>
              {loading ? 'Creando...' : 'Crear Encuesta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

