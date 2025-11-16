import { useState, useEffect } from 'react'
import { ContractPromise } from '@polkadot/api-contract'
import { AccountInfo, getDevAccounts } from '../utils/polkadot'
import { logger } from '../utils/logger'
import './VoteModal.css'

interface VoteModalProps {
  contract: ContractPromise
  pollId: number
  selectedAccount: AccountInfo | null
  onRequestAccount: () => void
  onClose: () => void
}

export default function VoteModal({ contract, pollId, selectedAccount, onRequestAccount, onClose }: VoteModalProps) {
  const [poll, setPoll] = useState<any>(null)
  const [selectedOption, setSelectedOption] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [voting, setVoting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tallies, setTallies] = useState<number[]>([])
  const [queryAddress, setQueryAddress] = useState<string | null>(null)

  // Obtener una dirección AccountId32 válida para queries
  useEffect(() => {
    const initQueryAddress = async () => {
      try {
        const devAccounts = await getDevAccounts()
        if (devAccounts.length > 0) {
          setQueryAddress(devAccounts[0].address)
          logger.debug('VoteModal: Dirección de query configurada', { address: devAccounts[0].address }, 'api')
        }
      } catch (e) {
        logger.warning('VoteModal: No se pudo obtener dirección de query', { error: e }, 'api')
      }
    }
    initQueryAddress()
  }, [contract])

  useEffect(() => {
    if (queryAddress) {
      loadPollData()
    }
  }, [pollId, queryAddress])

  const loadPollData = async () => {
    if (!queryAddress) {
      logger.debug('VoteModal: Esperando dirección de query...', null, 'api')
      return
    }
    
    try {
      const gasLimit = contract.abi.registry.createType('WeightV2', {
        refTime: 100000000000,
        proofSize: 1000000
      }) as any
      
      logger.debug(`VoteModal: Consultando getPoll(${pollId})`, { pollId, address: queryAddress }, 'contract')
      const result = await contract.query.getPoll(
        queryAddress,
        { value: 0, gasLimit },
        pollId
      )

      const output = result.output?.toHuman() as any
      if (output?.Ok) {
        const [exists, id, title, description, , maxOptions, , isActive, totalVotes] = output.Ok
        setPoll({
          exists: exists === true,
          id: Number(id),
          title: String(title),
          description: String(description),
          maxOptions: Number(maxOptions),
          isActive: isActive === true,
          totalVotes: Number(totalVotes)
        })

        // Cargar tallies
        const talliesData: number[] = []
        for (let i = 0; i < Number(maxOptions); i++) {
          const gasLimitTally = contract.abi.registry.createType('WeightV2', {
            refTime: 100000000000,
            proofSize: 1000000
          }) as any
          
          const tallyResult = await contract.query.getVoteTally(
            queryAddress,
            { value: 0, gasLimit: gasLimitTally },
            pollId,
            i
          )
          const output = tallyResult.output
          const tally = (output && typeof output === 'object' && 'toNumber' in output) 
            ? (output as any).toNumber() || 0 
            : 0
          talliesData.push(tally)
        }
        setTallies(talliesData)
      }
    } catch (err) {
      console.error('Error cargando poll:', err)
      setError('Error al cargar la encuesta')
    } finally {
      setLoading(false)
    }
  }

  const handleVote = async () => {
    if (!poll || selectedOption < 0 || selectedOption >= poll.maxOptions) {
      setError('Selecciona una opción válida')
      return
    }

    setVoting(true)
    setError(null)

    try {
      // TODO: En producción, aquí se generaría la prueba ZK
      // Por ahora, usamos valores mock para desarrollo
      const proof = new Uint8Array(100) // Mock proof
      const nullifier = '0x' + '00'.repeat(32) // Mock nullifier

      const gasLimit = contract.abi.registry.createType('WeightV2', {
        refTime: 300000000000,
        proofSize: 3000000
      }) as any

      const result = await contract.tx.castVote(
        {
          value: 0,
          gasLimit
        },
        pollId,
        proof,
        nullifier,
        selectedOption
      )

      if (!selectedAccount) {
        setError('Por favor, selecciona una cuenta primero')
        setVoting(false)
        onRequestAccount()
        return
      }

      // Para cuentas de desarrollo, pasar el par directamente
      // Para cuentas de extensión, pasar la dirección (el signer ya está configurado)
      if (selectedAccount.isDevAccount) {
        const { getPairForAddress } = await import('../utils/polkadot')
        const pair = await getPairForAddress(selectedAccount.address)
        await result.signAndSend(pair, (result: any) => {
          if (result.status.isInBlock || result.status.isFinalized) {
            setVoting(false)
            setTimeout(() => {
              onClose()
              window.location.reload()
            }, 2000)
          }
        })
      } else {
        await result.signAndSend(selectedAccount.address, (result: any) => {
          if (result.status.isInBlock || result.status.isFinalized) {
            setVoting(false)
            setTimeout(() => {
              onClose()
              window.location.reload()
            }, 2000)
          }
        })
      }
    } catch (err: any) {
      console.error('Error votando:', err)
      setError(err.message || 'Error al votar. Nota: Se requiere una prueba ZK válida.')
      setVoting(false)
    }
  }

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="loading">Cargando encuesta...</div>
        </div>
      </div>
    )
  }

  if (!poll || !poll.exists) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="error">Encuesta no encontrada</div>
          <button onClick={onClose}>Cerrar</button>
        </div>
      </div>
    )
  }

  const totalVotes = tallies.reduce((sum, tally) => sum + tally, 0)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content vote-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{poll.title}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="vote-content">
          <p className="vote-description">{poll.description}</p>

          {!poll.isActive && (
            <div className="poll-closed">Esta encuesta está cerrada</div>
          )}

          <div className="vote-options">
            <h3>Selecciona tu voto:</h3>
            {Array.from({ length: poll.maxOptions }, (_, i) => (
              <label key={i} className="vote-option">
                <input
                  type="radio"
                  name="vote"
                  value={i}
                  checked={selectedOption === i}
                  onChange={() => setSelectedOption(i)}
                  disabled={!poll.isActive || voting}
                />
                <span>Opción {i + 1}</span>
                {tallies[i] > 0 && (
                  <span className="vote-count">
                    {tallies[i]} votos ({totalVotes > 0 ? Math.round((tallies[i] / totalVotes) * 100) : 0}%)
                  </span>
                )}
              </label>
            ))}
          </div>

          {totalVotes > 0 && (
            <div className="vote-results">
              <h3>Resultados Actuales:</h3>
              {tallies.map((tally, index) => (
                <div key={index} className="result-bar">
                  <div className="result-label">
                    <span>Opción {index + 1}</span>
                    <span>{tally} votos</span>
                  </div>
                  <div className="result-progress">
                    <div
                      className="result-fill"
                      style={{ width: `${totalVotes > 0 ? (tally / totalVotes) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className="form-error">{error}</div>}

          {poll.isActive && (
            <div className="vote-actions">
              <button
                onClick={handleVote}
                disabled={voting || selectedOption < 0}
                className="btn-vote-submit"
              >
                {voting ? 'Votando...' : '🗳️ Enviar Voto'}
              </button>
              <p className="vote-note">
                ⚠️ Nota: Para votar en producción, necesitas generar una prueba ZK válida usando el circuito Noir.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

