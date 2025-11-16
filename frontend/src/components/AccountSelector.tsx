import { useState, useEffect } from 'react'
import { connectPolkadotExtension, AccountInfo, getDevAccounts } from '../utils/polkadot'
import { DEFAULT_NODE, NODE_CONFIGS, NodeType } from '../config'
import './AccountSelector.css'

interface AccountSelectorProps {
  onAccountSelected: (account: AccountInfo) => void
  onClose: () => void
  nodeType?: NodeType
}

export default function AccountSelector({ onAccountSelected, onClose, nodeType = DEFAULT_NODE }: AccountSelectorProps) {
  const [accounts, setAccounts] = useState<AccountInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isLocalNode = NODE_CONFIGS[nodeType]?.isLocal ?? false

  useEffect(() => {
    loadAccounts()
  }, [nodeType])

  const loadAccounts = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const allAccounts: AccountInfo[] = []
      
      // Si es nodo local, agregar cuentas de desarrollo
      if (isLocalNode) {
        const devAccounts = await getDevAccounts()
        allAccounts.push(...devAccounts)
      }
      
      // Intentar cargar cuentas de extensión
      try {
        const extensionAccounts = await connectPolkadotExtension()
        allAccounts.push(...extensionAccounts)
      } catch (extErr: any) {
        // Si no hay extensión, no es crítico si tenemos cuentas de desarrollo
        if (!isLocalNode || allAccounts.length === 0) {
          throw extErr
        }
      }
      
      setAccounts(allAccounts)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (account: AccountInfo) => {
    onAccountSelected(account)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content account-selector" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Seleccionar Cuenta</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="account-selector-content">
          {loading && <div className="loading">Cargando cuentas...</div>}
          
          {error && (
            <div className="error-message">
              <p>{error}</p>
              <button onClick={loadAccounts} className="btn-retry">Reintentar</button>
            </div>
          )}

          {!loading && !error && accounts.length === 0 && (
            <div className="no-accounts">
              <p>No se encontraron cuentas.</p>
              <p>Por favor, crea una cuenta en la extensión de Polkadot.js</p>
            </div>
          )}

          {!loading && !error && accounts.length > 0 && (
            <>
              <p className="select-hint">
                {isLocalNode 
                  ? 'Selecciona una cuenta (recomendado: //Alice para desarrollo)' 
                  : 'Selecciona una cuenta para firmar la transacción:'}
              </p>
              <div className="accounts-list">
                {accounts.map((account, index) => (
                  <div
                    key={`${account.address}-${account.meta.source}-${index}`}
                    className={`account-item ${account.isDevAccount ? 'dev-account' : ''}`}
                    onClick={() => handleSelect(account)}
                  >
                    <div className="account-info">
                      <div className="account-name">
                        {account.meta.name || 'Sin nombre'}
                        {account.isDevAccount && <span className="dev-badge">DEV</span>}
                      </div>
                      <div className="account-address">
                        {account.address.slice(0, 10)}...{account.address.slice(-8)}
                      </div>
                      <div className="account-source">
                        {account.meta.source}
                      </div>
                    </div>
                    <div className="account-select-arrow">→</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

