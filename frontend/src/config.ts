// Direcciones del contrato desplegado por red
export const CONTRACT_ADDRESSES: Record<NodeType, string | null> = {
  'ink-local': '0x5801b439a678d9d3a68b8019da6a4abfa507de11',
  'paseo': null, // No deployado aún
  'polkadot': null // No deployado aún
}

// Dirección del contrato por defecto (local)
export const CONTRACT_ADDRESS = CONTRACT_ADDRESSES['ink-local']!

// Tipos de nodo disponibles
export type NodeType = 'ink-local' | 'paseo' | 'polkadot'

// Configuración de nodos
export const NODE_CONFIGS: Record<NodeType, { url: string; name: string; isLocal: boolean; contractDeployed: boolean }> = {
  'ink-local': {
    url: 'ws://localhost:9944',
    name: 'ink-node (Local)',
    isLocal: true,
    contractDeployed: true
  },
  'paseo': {
    url: 'wss://paseo.rpc.amforc.com',
    name: 'Paseo Testnet',
    isLocal: false,
    contractDeployed: false // No deployado aún
  },
  'polkadot': {
    url: 'wss://rpc.polkadot.io',
    name: 'Polkadot Mainnet',
    isLocal: false,
    contractDeployed: false // No deployado aún
  }
}

// URL del nodo por defecto
export const DEFAULT_NODE: NodeType = 'ink-local'
export const NODE_URL = NODE_CONFIGS[DEFAULT_NODE].url

// ABI del contrato - se carga dinámicamente
export async function loadContractAbi() {
  const response = await fetch('/contracts/target/ink/contracts.json')
  return await response.json()
}

