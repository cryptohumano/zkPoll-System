/**
 * Sistema de logging centralizado para la aplicación
 * Almacena logs en memoria y permite visualizarlos en un modal
 */

export enum LogLevel {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
  DEBUG = 'debug'
}

export interface LogEntry {
  id: string
  timestamp: number
  level: LogLevel
  message: string
  data?: any
  source?: string // 'contract', 'database', 'api', 'ui', etc.
}

class Logger {
  private logs: LogEntry[] = []
  private maxLogs = 1000
  private listeners: Set<(logs: LogEntry[]) => void> = new Set()

  log(level: LogLevel, message: string, data?: any, source?: string) {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      level,
      message,
      data,
      source
    }

    this.logs.push(entry)
    
    // Mantener solo los últimos maxLogs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }

    // Notificar a los listeners
    this.listeners.forEach(listener => listener([...this.logs]))

    // También loggear en consola
    const emoji = this.getEmoji(level)
    const prefix = source ? `[${source}]` : ''
    console.log(`${emoji} ${prefix} ${message}`, data || '')
  }

  private getEmoji(level: LogLevel): string {
    switch (level) {
      case LogLevel.SUCCESS: return '✅'
      case LogLevel.WARNING: return '⚠️'
      case LogLevel.ERROR: return '❌'
      case LogLevel.DEBUG: return '🔍'
      default: return '📋'
    }
  }

  info(message: string, data?: any, source?: string) {
    this.log(LogLevel.INFO, message, data, source)
  }

  success(message: string, data?: any, source?: string) {
    this.log(LogLevel.SUCCESS, message, data, source)
  }

  warning(message: string, data?: any, source?: string) {
    this.log(LogLevel.WARNING, message, data, source)
  }

  error(message: string, data?: any, source?: string) {
    this.log(LogLevel.ERROR, message, data, source)
  }

  debug(message: string, data?: any, source?: string) {
    this.log(LogLevel.DEBUG, message, data, source)
  }

  getLogs(): LogEntry[] {
    return [...this.logs]
  }

  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level)
  }

  getLogsBySource(source: string): LogEntry[] {
    return this.logs.filter(log => log.source === source)
  }

  clear() {
    this.logs = []
    this.listeners.forEach(listener => listener([]))
  }

  subscribe(listener: (logs: LogEntry[]) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // Helpers para logs específicos
  contract(message: string, data?: any) {
    this.info(message, data, 'contract')
  }

  database(message: string, data?: any) {
    this.info(message, data, 'database')
  }

  api(message: string, data?: any) {
    this.info(message, data, 'api')
  }

  chain(message: string, data?: any) {
    this.info(message, data, 'chain')
  }
  
  // Helper para logs de blockchain
  blockchain(message: string, data?: any) {
    this.info(message, data, 'chain')
  }
}

export const logger = new Logger()

// Exponer en window para acceso desde consola
if (typeof window !== 'undefined') {
  (window as any).appLogger = logger
}

