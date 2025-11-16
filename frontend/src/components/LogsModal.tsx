import { useState, useEffect, useRef } from 'react'
import { logger, LogEntry, LogLevel } from '../utils/logger'
import './LogsModal.css'

interface LogsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function LogsModal({ isOpen, onClose }: LogsModalProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    // Cargar logs iniciales
    setLogs(logger.getLogs())

    // Suscribirse a nuevos logs
    const unsubscribe = logger.subscribe((newLogs) => {
      setLogs(newLogs)
    })

    return unsubscribe
  }, [isOpen])

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  const handleScroll = () => {
    if (logsContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
      setAutoScroll(isAtBottom)
    }
  }

  const filteredLogs = logs.filter(log => {
    if (filter !== 'all' && log.level !== filter) return false
    if (sourceFilter !== 'all' && log.source !== sourceFilter) return false
    return true
  })

  const sources = Array.from(new Set(logs.map(log => log.source).filter(Boolean)))

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    })
  }

  const getLevelClass = (level: LogLevel): string => {
    return `log-entry log-${level}`
  }

  const getLevelEmoji = (level: LogLevel): string => {
    switch (level) {
      case LogLevel.SUCCESS: return '✅'
      case LogLevel.WARNING: return '⚠️'
      case LogLevel.ERROR: return '❌'
      case LogLevel.DEBUG: return '🔍'
      default: return '📋'
    }
  }

  const exportLogs = () => {
    const dataStr = JSON.stringify(filteredLogs, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `zk-poll-logs-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!isOpen) return null

  return (
    <div className="logs-modal-overlay" onClick={onClose}>
      <div className="logs-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="logs-modal-header">
          <h2>📊 Logs del Sistema</h2>
          <div className="logs-modal-actions">
            <button onClick={exportLogs} className="btn-export">Exportar</button>
            <button onClick={() => logger.clear()} className="btn-clear">Limpiar</button>
            <button onClick={onClose} className="btn-close">×</button>
          </div>
        </div>

        <div className="logs-modal-filters">
          <div className="filter-group">
            <label>Nivel:</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as LogLevel | 'all')}>
              <option value="all">Todos</option>
              <option value={LogLevel.INFO}>Info</option>
              <option value={LogLevel.SUCCESS}>Éxito</option>
              <option value={LogLevel.WARNING}>Advertencia</option>
              <option value={LogLevel.ERROR}>Error</option>
              <option value={LogLevel.DEBUG}>Debug</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Fuente:</label>
            <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">Todas</option>
              {sources.map(source => (
                <option key={source} value={source}>{source}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
          </div>

          <div className="filter-group">
            <span className="log-count">{filteredLogs.length} logs</span>
          </div>
        </div>

        <div
          className="logs-container"
          ref={logsContainerRef}
          onScroll={handleScroll}
        >
          {filteredLogs.length === 0 ? (
            <div className="logs-empty">No hay logs para mostrar</div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className={getLevelClass(log.level)}>
                <div className="log-header">
                  <span className="log-emoji">{getLevelEmoji(log.level)}</span>
                  <span className="log-time">{formatTimestamp(log.timestamp)}</span>
                  {log.source && (
                    <span className="log-source">[{log.source}]</span>
                  )}
                  <span className="log-level">{log.level}</span>
                </div>
                <div className="log-message">{log.message}</div>
                {log.data && (
                  <details className="log-data">
                    <summary>Datos</summary>
                    <pre>{JSON.stringify(log.data, null, 2)}</pre>
                  </details>
                )}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )
}

