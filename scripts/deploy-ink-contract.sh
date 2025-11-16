#!/bin/bash
# Script para desplegar el contrato Ink! en ink-node local

set -e

echo "🚀 Desplegando contrato Ink! AnonymousPoll..."

# Verificar que ink-node está corriendo
if ! curl -s http://localhost:9944 > /dev/null; then
    echo "❌ Error: ink-node no está corriendo en http://localhost:9944"
    echo "   Inicia ink-node con: ./ink-node --dev --tmp"
    exit 1
fi

# Verificar que tenemos el contrato compilado
if [ ! -f "contracts/target/ink/contracts.contract" ]; then
    echo "❌ Error: Contrato no compilado. Ejecuta: cd contracts && cargo contract build --release"
    exit 1
fi

# Solicitar dirección del verificador
if [ -z "$VERIFIER_ADDRESS" ]; then
    echo "📝 Ingresa la dirección del contrato verificador (H160, formato: 0x...):"
    read VERIFIER_ADDRESS
fi

if [ -z "$VERIFIER_ADDRESS" ]; then
    echo "❌ Error: Se requiere la dirección del verificador"
    exit 1
fi

echo ""
echo "📋 Configuración de despliegue:"
echo "   - Nodo: http://localhost:9944"
echo "   - Verificador: $VERIFIER_ADDRESS"
echo "   - Cuenta: //Alice (desarrollo)"
echo ""

# Desplegar el contrato
cd contracts

echo "🔨 Instanciando contrato..."
cargo contract instantiate \
    --constructor new \
    --args "$VERIFIER_ADDRESS" \
    --suri //Alice \
    --url ws://localhost:9944 \
    --skip-confirm \
    --execute

echo ""
echo "✅ Contrato desplegado exitosamente!"
echo ""
echo "📝 Para interactuar con el contrato, usa:"
echo "   cargo contract call --contract <CONTRACT_ADDRESS> --message <METHOD> --suri //Alice --url ws://localhost:9944"


