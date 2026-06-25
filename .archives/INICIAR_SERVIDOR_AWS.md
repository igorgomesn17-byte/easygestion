# 🚀 COMO INICIAR O SERVIDOR EC2 NO AWS

## ⚠️ O servidor está OFFLINE

Você precisa iniciar manualmente no AWS Console.

---

## 📋 PASSO A PASSO

### 1️⃣ Abra o AWS Console
Acesse: https://console.aws.amazon.com

### 2️⃣ Vá para EC2
- Clique em **"Services"** (canto superior esquerdo)
- Procure por **"EC2"** e clique
- No menu esquerdo, clique em **"Instances"**

### 3️⃣ Procure pela Instância
- Procure por uma instância com **IP 54.232.189.113**
- Ou procure por nome que tenha "easygestion" ou "prod"

### 4️⃣ Verificar Estado
Olhe a coluna **"Instance State"**:
- 🔴 **stopped** → Servidor está desligado (você precisa iniciar)
- 🟢 **running** → Servidor está ligado (tá funcionando)

### 5️⃣ Se Estiver STOPPED (Desligado)

1. **Selecione a instância** (clique no checkbox à esquerda)
2. Clique no botão **"Instance State"** (canto superior direito)
3. Clique em **"Start instance"**
4. Aguarde 1-2 minutos até ficar 🟢 **running**
5. Copie o **Public IPv4 address** (deve ser 54.232.189.113)

### 6️⃣ Depois que Iniciar

Volte aqui e avise que o servidor está 🟢 **running**, que eu faço o deploy automaticamente!

---

## 🔗 ACESSO RÁPIDO

| Campo | Link/Info |
|-------|-----------|
| **AWS Console** | https://console.aws.amazon.com |
| **EC2 Dashboard** | https://console.aws.amazon.com/ec2/v2/home?region=sa-east-1#Instances: |
| **IP do Servidor** | 54.232.189.113 |
| **Região** | sa-east-1 (São Paulo) |

---

## ❓ DÚVIDAS COMUNS

**P: Onde eu vejo se tá running ou stopped?**  
R: Na coluna **"Instance State"** — verde = running, cinza = stopped

**P: Quanto vai custar deixar rodando?**  
R: Nada durante 12 meses (Free Tier). Depois: ~R$25/mês

**P: Quanto tempo leva pra iniciar?**  
R: 1-2 minutos normalmente

**P: E se não aparecer nenhuma instância?**  
R: Você pode ter deletado. Nesse caso, criaremos uma nova via CLI.

---

## 🆘 PROBLEMA: NÃO ENCONTRO A INSTÂNCIA

Se não encontrar nenhuma instância no console, execute este comando no PowerShell:

```powershell
# Criar nova instância (atalho)
# [Você vai precisar de permissões EC2]
```

Ou entre em contato — vou criar uma instância nova pra você.

---

**Avise quando o servidor estiver 🟢 RUNNING e faço o deploy!**
