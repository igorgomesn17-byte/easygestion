#!/bin/bash

echo "🚀 TESTE STRIPE EASYGESTION"
echo "═════════════════════════════════════════════"
echo ""

# 1. Verificar se as chaves estão no .env
echo "✅ Verificando configuração Stripe..."
if grep -q "STRIPE_SECRET_KEY" .env; then
  echo "   ✓ STRIPE_SECRET_KEY configurada"
else
  echo "   ✗ STRIPE_SECRET_KEY NÃO encontrada"
fi

if grep -q "STRIPE_PUBLISHABLE_KEY" .env; then
  echo "   ✓ STRIPE_PUBLISHABLE_KEY configurada"
else
  echo "   ✗ STRIPE_PUBLISHABLE_KEY NÃO encontrada"
fi

if grep -q "STRIPE_WEBHOOK_SECRET" .env; then
  echo "   ✓ STRIPE_WEBHOOK_SECRET configurada"
else
  echo "   ✗ STRIPE_WEBHOOK_SECRET NÃO encontrada"
fi

echo ""
echo "📋 Próximas ações:"
echo ""
echo "1️⃣ Abra um terminal novo e rode:"
echo "   npm start"
echo ""
echo "2️⃣ Depois, abra outro terminal e rode:"
echo "   stripe listen --forward-to localhost:3001/api/webhooks/stripe"
echo ""
echo "3️⃣ Na primeira vez, você vai precisar fazer login. Siga os passos!"
echo ""
echo "4️⃣ Depois acesse:"
echo "   http://localhost:3001/assinatura.html"
echo ""
echo "5️⃣ Clique em 'Contratar' e teste o checkout Stripe"
echo ""
echo "✨ Teste com cartão: 4242 4242 4242 4242"
echo "✨ Data: 12/25 | CVC: 123"
echo ""
