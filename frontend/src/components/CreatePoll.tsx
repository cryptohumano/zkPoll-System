import { useState, useEffect } from 'react'
import { ContractPromise } from '@polkadot/api-contract'
import { ApiPromise } from '@polkadot/api'
import { AccountInfo } from '../utils/polkadot'
import { savePollMetadata } from '../utils/database'
import { NODE_CONFIGS, NodeType } from '../config'
import { logger } from '../utils/logger'
import './CreatePoll.css'

interface CreatePollProps {
  contract: ContractPromise
  api: ApiPromise | null
  selectedAccount: AccountInfo | null
  nodeType?: NodeType
  onClose: () => void
  onPollCreated?: () => void // Callback cuando se crea una poll exitosamente
}

export default function CreatePoll({ contract, api, selectedAccount, nodeType = 'ink-local', onClose, onPollCreated }: CreatePollProps) {
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
          logger.debug('📨 Estado de transacción recibido', { 
            isInBlock: result.status.isInBlock,
            isFinalized: result.status.isFinalized,
            status: result.status.type,
            hasDispatchError: !!result.dispatchError
          }, 'contract')
          
          // Verificar si la transacción falló
          if (result.dispatchError) {
            let errorMessage = 'La transacción falló en la cadena.'
            
            try {
              // Intentar decodificar el error para obtener un mensaje más útil
              if (api && result.dispatchError) {
                const decodedError = api.registry.findMetaError(result.dispatchError)
                if (decodedError) {
                  errorMessage = `Error: ${decodedError.section}.${decodedError.name}`
                  logger.error('❌ Transacción falló (decodificado)', { 
                    section: decodedError.section,
                    name: decodedError.name,
                    docs: decodedError.docs,
                    error: result.dispatchError
                  }, 'contract')
                  
                  // Mensajes específicos para errores comunes
                  if (decodedError.section === 'contracts') {
                    if (decodedError.name === 'OutOfGas') {
                      errorMessage = 'Error: La transacción se quedó sin gas. Intenta aumentar el límite de gas.'
                    } else if (decodedError.name === 'CodeNotFound') {
                      errorMessage = 'Error: Código del contrato no encontrado. Verifica que el contrato esté desplegado.'
                    } else if (decodedError.name === 'NotCallable') {
                      errorMessage = 'Error: El método del contrato no es invocable. Verifica los parámetros.'
                    } else if (decodedError.name === 'Trap') {
                      errorMessage = 'Error: El contrato ejecutó una trampa (trap). Verifica los parámetros de entrada.'
                    } else if (decodedError.name === 'StorageDepositLimitExceeded') {
                      errorMessage = 'Error: Límite de depósito de almacenamiento excedido.'
                    } else {
                      errorMessage = `Error del contrato: ${decodedError.name}. ${decodedError.docs || ''}`
                    }
                  } else if (decodedError.section === 'system') {
                    if (decodedError.name === 'InvalidTransaction') {
                      errorMessage = 'Error: Transacción inválida. Verifica que tengas fondos suficientes.'
                    } else {
                      errorMessage = `Error del sistema: ${decodedError.name}. ${decodedError.docs || ''}`
                    }
                  }
                } else {
                  // Si no se puede decodificar, intentar obtener información del error
                  const errorStr = result.dispatchError.toString()
                  logger.error('❌ Transacción falló (no decodificado)', { 
                    error: errorStr,
                    events: result.events
                  }, 'contract')
                  errorMessage = `Error desconocido: ${errorStr}`
                }
              }
            } catch (decodeError: any) {
              logger.error('❌ Error decodificando dispatchError', { 
                decodeError: decodeError.message,
                originalError: result.dispatchError
              }, 'contract')
              errorMessage = 'La transacción falló. Verifica los logs para más detalles.'
            }
            
            setError(errorMessage)
            setLoading(false)
            return
          }
          
          // Verificar eventos de error
          if (result.events) {
            for (const eventRecord of result.events) {
              const event = eventRecord.event
              if (event && event.section === 'system' && event.method === 'ExtrinsicFailed') {
                logger.error('❌ Transacción falló (ExtrinsicFailed)', { 
                  event: event.data
                }, 'contract')
                setError('La transacción falló en la cadena. Verifica que tengas suficientes fondos y permisos.')
                setLoading(false)
                return
              }
            }
          }
          
          if (result.status.isInBlock || result.status.isFinalized) {
            logger.info('✅ Transacción confirmada en bloque', { 
              isInBlock: result.status.isInBlock,
              isFinalized: result.status.isFinalized
            }, 'contract')
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
                logger.debug('🔄 Intentando obtener pollId del total de polls...', null, 'contract')
                // Obtener una dirección AccountId32 válida para queries (no usar contract.address que es H160)
                const { getDevAccounts } = await import('../utils/polkadot')
                const devAccounts = await getDevAccounts()
                const queryAddress = devAccounts.length > 0 ? devAccounts[0].address : null
                
                if (!queryAddress) {
                  logger.warning('No se pudo obtener dirección AccountId32 para query', null, 'contract')
                  throw new Error('No se pudo obtener dirección de query')
                }
                
                const gasLimit = contract.abi.registry.createType('WeightV2', {
                  refTime: 100000000000,
                  proofSize: 1000000
                }) as any
                
                // Esperar un poco para que la transacción se procese
                await new Promise(resolve => setTimeout(resolve, 2000))
                
                const totalResult = await contract.query.getTotalPolls(
                  queryAddress,
                  { value: 0, gasLimit }
                )
                
                // Parsear el resultado igual que en PollList.tsx
                const output = totalResult.output
                let total = 0
                
                if (output && typeof output === 'object' && 'toHuman' in output) {
                  const humanOutput = (output as any).toHuman()
                  if (humanOutput && typeof humanOutput === 'object') {
                    if ('Ok' in humanOutput) {
                      const okValue = humanOutput.Ok
                      total = typeof okValue === 'string' ? Number(okValue) || 0 : 
                              typeof okValue === 'number' ? okValue : 0
                    } else if ('ok' in humanOutput) {
                      const okValue = humanOutput.ok
                      total = typeof okValue === 'string' ? Number(okValue) || 0 : 
                              typeof okValue === 'number' ? okValue : 0
                    }
                  }
                }
                
                if (total > 0) {
                  pollId = total
                  logger.info(`✅ PollId obtenido del total de polls: ${pollId}`, { pollId }, 'contract')
                } else {
                  logger.warning('No se pudo obtener pollId del total de polls', { total }, 'contract')
                }
              } catch (e: any) {
                logger.warning('Error obteniendo pollId del total', { error: e.message }, 'contract')
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
            
            // Notificar inmediatamente que se creó una poll (el sistema de verificación esperará)
            // IMPORTANTE: Llamar al callback incluso si pollId es 0, porque el sistema de verificación
            // puede detectar el cambio en getTotalPolls()
            logger.info('📢 Preparando notificación de poll creada', { 
              pollId,
              hasCallback: !!onPollCreated 
            }, 'contract')
            
            if (onPollCreated) {
              try {
                logger.info('📢 Ejecutando callback onPollCreated', { pollId }, 'contract')
                onPollCreated()
                logger.success('✅ Callback onPollCreated ejecutado exitosamente', null, 'contract')
              } catch (e) {
                logger.error('❌ Error ejecutando callback onPollCreated', e, 'contract')
              }
            } else {
              logger.warning('⚠️ onPollCreated callback no está definido', null, 'contract')
            }
            
            // Cerrar el modal después de un delay
            setTimeout(() => {
              onClose()
              // No recargar la página completa, solo cerrar el modal
              // La recarga se hará automáticamente por el trigger
            }, 2000)
          }
        })
      } else {
        await result.signAndSend(selectedAccount.address, async (result: any) => {
          logger.debug('📨 Estado de transacción recibido', { 
            isInBlock: result.status.isInBlock,
            isFinalized: result.status.isFinalized,
            status: result.status.type,
            hasDispatchError: !!result.dispatchError
          }, 'contract')
          
          // Verificar si la transacción falló
          if (result.dispatchError) {
            let errorMessage = 'La transacción falló en la cadena.'
            
            try {
              // Intentar decodificar el error para obtener un mensaje más útil
              if (api && result.dispatchError) {
                const decodedError = api.registry.findMetaError(result.dispatchError)
                if (decodedError) {
                  errorMessage = `Error: ${decodedError.section}.${decodedError.name}`
                  logger.error('❌ Transacción falló (decodificado)', { 
                    section: decodedError.section,
                    name: decodedError.name,
                    docs: decodedError.docs,
                    error: result.dispatchError
                  }, 'contract')
                  
                  // Mensajes específicos para errores comunes
                  if (decodedError.section === 'contracts') {
                    if (decodedError.name === 'OutOfGas') {
                      errorMessage = 'Error: La transacción se quedó sin gas. Intenta aumentar el límite de gas.'
                    } else if (decodedError.name === 'CodeNotFound') {
                      errorMessage = 'Error: Código del contrato no encontrado. Verifica que el contrato esté desplegado.'
                    } else if (decodedError.name === 'NotCallable') {
                      errorMessage = 'Error: El método del contrato no es invocable. Verifica los parámetros.'
                    } else if (decodedError.name === 'Trap') {
                      errorMessage = 'Error: El contrato ejecutó una trampa (trap). Verifica los parámetros de entrada.'
                    } else if (decodedError.name === 'StorageDepositLimitExceeded') {
                      errorMessage = 'Error: Límite de depósito de almacenamiento excedido.'
                    } else {
                      errorMessage = `Error del contrato: ${decodedError.name}. ${decodedError.docs || ''}`
                    }
                  } else if (decodedError.section === 'system') {
                    if (decodedError.name === 'InvalidTransaction') {
                      errorMessage = 'Error: Transacción inválida. Verifica que tengas fondos suficientes.'
                    } else {
                      errorMessage = `Error del sistema: ${decodedError.name}. ${decodedError.docs || ''}`
                    }
                  }
                } else {
                  // Si no se puede decodificar, intentar obtener información del error
                  const errorStr = result.dispatchError.toString()
                  logger.error('❌ Transacción falló (no decodificado)', { 
                    error: errorStr,
                    events: result.events
                  }, 'contract')
                  errorMessage = `Error desconocido: ${errorStr}`
                }
              }
            } catch (decodeError: any) {
              logger.error('❌ Error decodificando dispatchError', { 
                decodeError: decodeError.message,
                originalError: result.dispatchError
              }, 'contract')
              errorMessage = 'La transacción falló. Verifica los logs para más detalles.'
            }
            
            setError(errorMessage)
            setLoading(false)
            return
          }
          
          // Verificar eventos de error
          if (result.events) {
            for (const eventRecord of result.events) {
              const event = eventRecord.event
              if (event && event.section === 'system' && event.method === 'ExtrinsicFailed') {
                logger.error('❌ Transacción falló (ExtrinsicFailed)', { 
                  event: event.data
                }, 'contract')
                setError('La transacción falló en la cadena. Verifica que tengas suficientes fondos y permisos.')
                setLoading(false)
                return
              }
            }
          }
          
          if (result.status.isInBlock || result.status.isFinalized) {
            logger.info('✅ Transacción confirmada en bloque', { 
              isInBlock: result.status.isInBlock,
              isFinalized: result.status.isFinalized
            }, 'contract')
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
                logger.debug('🔄 Intentando obtener pollId del total de polls...', null, 'contract')
                // Obtener una dirección AccountId32 válida para queries (no usar contract.address que es H160)
                const { getDevAccounts } = await import('../utils/polkadot')
                const devAccounts = await getDevAccounts()
                const queryAddress = devAccounts.length > 0 ? devAccounts[0].address : null
                
                if (!queryAddress) {
                  logger.warning('No se pudo obtener dirección AccountId32 para query', null, 'contract')
                  throw new Error('No se pudo obtener dirección de query')
                }
                
                const gasLimit = contract.abi.registry.createType('WeightV2', {
                  refTime: 100000000000,
                  proofSize: 1000000
                }) as any
                
                // Esperar un poco para que la transacción se procese
                await new Promise(resolve => setTimeout(resolve, 2000))
                
                const totalResult = await contract.query.getTotalPolls(
                  queryAddress,
                  { value: 0, gasLimit }
                )
                
                // Parsear el resultado igual que en PollList.tsx
                const output = totalResult.output
                let total = 0
                
                if (output && typeof output === 'object' && 'toHuman' in output) {
                  const humanOutput = (output as any).toHuman()
                  if (humanOutput && typeof humanOutput === 'object') {
                    if ('Ok' in humanOutput) {
                      const okValue = humanOutput.Ok
                      total = typeof okValue === 'string' ? Number(okValue) || 0 : 
                              typeof okValue === 'number' ? okValue : 0
                    } else if ('ok' in humanOutput) {
                      const okValue = humanOutput.ok
                      total = typeof okValue === 'string' ? Number(okValue) || 0 : 
                              typeof okValue === 'number' ? okValue : 0
                    }
                  }
                }
                
                if (total > 0) {
                  pollId = total
                  logger.info(`✅ PollId obtenido del total de polls: ${pollId}`, { pollId }, 'contract')
                } else {
                  logger.warning('No se pudo obtener pollId del total de polls', { total }, 'contract')
                }
              } catch (e: any) {
                logger.warning('Error obteniendo pollId del total', { error: e.message }, 'contract')
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
            
            // Notificar inmediatamente que se creó una poll (el sistema de verificación esperará)
            // IMPORTANTE: Llamar al callback incluso si pollId es 0, porque el sistema de verificación
            // puede detectar el cambio en getTotalPolls()
            logger.info('📢 Preparando notificación de poll creada', { 
              pollId,
              hasCallback: !!onPollCreated 
            }, 'contract')
            
            if (onPollCreated) {
              try {
                logger.info('📢 Ejecutando callback onPollCreated', { pollId }, 'contract')
                onPollCreated()
                logger.success('✅ Callback onPollCreated ejecutado exitosamente', null, 'contract')
              } catch (e) {
                logger.error('❌ Error ejecutando callback onPollCreated', e, 'contract')
              }
            } else {
              logger.warning('⚠️ onPollCreated callback no está definido', null, 'contract')
            }
            
            // Cerrar el modal después de un delay
            setTimeout(() => {
              onClose()
              // No recargar la página completa, solo cerrar el modal
              // La recarga se hará automáticamente por el trigger
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

