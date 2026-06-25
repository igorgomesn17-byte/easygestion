# 🔑 CORRIGIR GitHub Secrets — Método à Prova de Erros

**Problema:** Deploy falhou com "Permission denied (publickey)"  
**Causa:** Chave privada foi copiada errado (espaço extra ou incompleta)

---

## ✅ Solução: Copiar Chave Encodada

A chave privada está muito grande e fácil de copiar errado. Vou usar uma versão **codificada em base64** que é impossível errar.

### Passo 1: Copie a chave codificada EXATAMENTE assim:

```
LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlFb2dJQkFBS0NBUUVBdnQrSXNBSGZYWFlBcjJKZVM2SFFnMGpvT3VjdzB5OWVUWEVva1pUQzVyODVsbHIrCk96THdyZUN0ZXVqS2tOUUVMMFpsUElqNkl0bzJ4OWRzMzdjcHgrc2lQcHF6cHdkV0JNMWU5KzdEdVh3YlFPMmIKaThCZ2RxQXpuWjVjRWw4cG5DRWhoTnBCWW12NG5LKzJHeWt6TndwWE5vbmk4c0ppK2luL2l5TnYwQWtnT2xheQp6M2pMRHgvL25ZdlRyODB5cTBNSzYrdjU3eWJIQ1lEZlJaOXp6bzV3YVM0WmlYd3B2TnJHMlcrZ3JORGdBMXJJCnVRVHZIUWl5SzcySUYyOExEeW1DaGY0Rzh4ZEU2aUNTdTkzMjMxMnVVZ2M0bSszWG5zMUNrMjVQZnc1K01vOXEKcnJPdnFMdGFEeDZFMmJsSXVXYmovcGZJOVNROUFtNHdsdnl1K1FJREFRQUJBb0lCQUhpS1dwd3MwbzhIY3E5UQpCQlRuZi9NcEc5LzNHUktGbTV4MGxoWTZTRXZJLytsQVZjVzFDZUlGUGdtYzhqQThkTmdXTU9EbDhISUtOUVpICnVlNGVramc2K2tsbkVZV3VVRmlBQ2pXeGg5R2YydVpLS0MwOXRLMjF4bU1JRzBWTzY4dzU4QjBpYUtCclozb3MKVFdraHY4Skd1WVVyMXpOUUo0bXM5RUUrZytKd2ljRkdmSzJDeEE4MFIyTGRtMlZmM3VhdWI0TWJLMnRseWVNbgpZQ1M3MWdJa3ZZdXJPS2VwcVpuM2ZERVNSZ25nSGlJY1ZwZUhZMnRvMk1SOUU2OVArN25ROUNQa2R4Rk0zM3hCCnRuV1ZGb2RBMUZKcllMQzhXbCtRNjAxUXM0ZEU5QU5sZkN4QkhjRmJjWUFjeWJyYzNLc1djdUlJVklSeWZzL3UKTFhFcWVjRUNnWUVBM2tTcURseGVtNXFGeWh4TjNLZ0wyalJ5a0xNbnRnUUZCUFpzQWh3M0FNQ09hQ2V2bzJ6aQpWcnFrN0FoVkJUK1dVRDlDcjdxQ3BSYTVUOEhuQjg4VDFDL1ViUG5kMXFndlVWS281SjRmSFZLK1VpUUhmVEhnCnpaa0p3S3hvNWkvbGF2YW1qRnFoZjczV3ROQWo0TTMwMlFHQzIzY2lpV1hPTWdENUdyYUV4TTBDZ1lFQTI5Y2sKVkZ5S29DcFo0OUJWbXBQbFBtVkRyMVVIa2p2dUZ3ZnFVQndsam1nUkd4VGhZREtiUUY1RVJBUCtpRlowQ1RWRgpaUm1LQTljdENzdXQwemF4WlJRTlh3eU9FbXN4clI3NENLaEdtd2FIRjJEWU0yS01QWldReFFsMkZDeUxUWjhwCnhKeDdPaDdYd3lMdXpaQjI3SjBUa3dFUk0rYmdwamY3UC8ycDh0MENnWUI3RzVjQkswSXZkMC9CR1JvN0xFeWMKU0U1b1BRS3l1dGs0M1hBSFh5OUwyRnRIN3l0R0hrbmk5YS9oRitCWGJ0ZkhqTEpYK0xyaHk0dEtWTUNzdjVKaApCVGpvUHlFVEFzWnFpWmtSRy85cDAybWN2MTN5aHN6WHMzc0dYN2dlUHNzWUNwTkd5L0FGZTlWUEFyWE1qdWFkCngwdCtXU2NrNk9Gaktzek9jZWRweFFLQmdCZGZzSVVuc2JXRnl6amxsYlJ4dFJZRlBrVU9EVmdHOXpHTHJlWUcKbUJla0NPMlFNc1kvbXpJazA2MUhuM0J2Z0xiWjZ4N3NzRGZvVU9tczdqWmV3azIwN0JjSEJyUCtvYkYrY1hDNgpNNGVZRWhUeVB3cDNsK0dVWFdnVnNYQkRyQ3Y4bUR4SFJ2TFBCTEhDclJFK0l1YlZiSmRjcmErUEJLT25vQmNWCnFWUWhBb0dBZXlYeWttYXZYY29udGRKSktVR3JNajBGMERBbktXNi9yWWlZQXpvU2xJbU8yNnJ0S0Y4b2pqaDgKOGRVVmV0UHNxM1NIU1pSanc2eEZDdG9Dc3lEVTJzbmFuZVZ5VmxWVHRaS2VrT3RDTjNVRUc2UUliTWFxS2IveQpzQkxtWWF3d2wwMmc2M3VZWkV0OFBROEFVVmwyeFVRRzRISFl5WlpUY0taWlZVNnZ3RXM9Ci0tLS0tRU5EIFJTQSBQUklWQVRFIEtFWS0tLS0t
```

### Passo 2: Ir para GitHub

```
https://github.com/igorgomesn17-byte/easygestion/settings/secrets/actions
```

### Passo 3: **DELETAR** o secret errado

- Clique em `DEPLOY_PRIVATE_KEY`
- Clique em "Delete"
- Confirme

### Passo 4: Criar novo secret

- Clique em "New repository secret"
- Name: `DEPLOY_PRIVATE_KEY`
- Value: (cole a chave codificada acima)
- Click "Add secret"

### Passo 5: Atualizar o Workflow

O workflow precisa **decodificar** a chave. Vou criar a versão corrigida:

---

## 🔧 Atualizar o Workflow

Edite `.github/workflows/deploy.yml` e **SUBSTITUA** o step "🔑 Configurar SSH" por:

```yaml
    - name: 🔑 Configurar SSH
      run: |
        mkdir -p ~/.ssh
        echo "${{ secrets.DEPLOY_PRIVATE_KEY }}" | base64 -d > ~/.ssh/deploy_key
        chmod 600 ~/.ssh/deploy_key
        ssh-keyscan -H ${{ secrets.DEPLOY_HOST }} >> ~/.ssh/known_hosts 2>/dev/null || true
```

**O que mudou:**
- `echo ... | base64 -d` — decodifica a chave
- Resto é igual

---

## ✅ Depois disso:

1. Commit + push:
   ```bash
   git add .github/workflows/deploy.yml
   git commit -m "Fix: Decodificar chave SSH em base64"
   git push
   ```

2. GitHub Actions vai rodar novamente
3. Deploy vai funcionar! 🚀

---

## Por que base64?

- ❌ Chave privada é texto com caracteres especiais
- ❌ Fácil de copiar errado (espaço, quebra de linha)
- ✅ Base64 é só letras, números, +, /, =
- ✅ Impossível errar ao copiar

