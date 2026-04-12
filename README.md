# UrbanIA 🏛

**Analyse PLU intelligente connectée au Géoportail de l'Urbanisme**

Posez n'importe quelle question en langage naturel sur votre parcelle.  
L'IA analyse le PLU officiel de votre commune et vous répond : **OUI / NON / SOUS CONDITIONS**.

---

## Architecture

```
[Navigateur]
    ↓ question + adresse
[Serveur Node.js — server/index.js]
    ↓                    ↓                    ↓
[api-adresse.gouv.fr]  [GPU IGN]    [Anthropic Claude]
 Géocodage              Zone PLU      Analyse IA
```

---

## Installation

### 1. Cloner / décompresser le projet

```bash
cd urbanIA
npm install
```

### 2. Configurer les clés API

```bash
cp .env.example .env
```

Éditez `.env` et renseignez :

```env
# Clé Anthropic (Claude)
# → https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# Clé IGN / Géoportail de l'Urbanisme (optionnelle mais recommandée)
# → https://geoservices.ign.fr/services-web-experts-urbanisme
# → Créer un compte gratuit → Nouvelle clé → Type "Développement"
IGN_API_KEY=...
```

> 💡 **Sans clé IGN** : l'app utilise l'API APICarto publique de l'IGN (quota limité).  
> Avec la clé, l'accès WFS est illimité et plus précis.

### 3. Démarrer le serveur

```bash
# Production
npm start

# Développement (rechargement auto)
npm run dev
```

Ouvrez **http://localhost:3000**

---

## Utilisation

1. Tapez votre **question en langage naturel**  
   _"Puis-je construire une véranda dans mon jardin ?"_

2. Entrez votre **adresse exacte**  
   _"12 rue de la Paix, Fontainebleau"_

3. Cliquez **Analyser →**

Le système :
- Géolocalise l'adresse (API Adresse officielle)
- Identifie la zone PLU réelle (Géoportail de l'Urbanisme)
- Analyse les règles applicables (Claude IA)
- Répond avec **verdict + règles chiffrées + étapes pratiques**

---

## Déploiement

### Vercel (recommandé — gratuit)

```bash
npm install -g vercel
vercel
# Suivre les instructions
# Ajouter les variables d'environnement dans le dashboard Vercel
```

### Railway

1. Créer un projet sur [railway.app](https://railway.app)
2. Connecter le repo GitHub
3. Ajouter les variables d'environnement
4. Deploy automatique

### Render

1. Créer un "Web Service" sur [render.com](https://render.com)
2. Build command : `npm install`
3. Start command : `npm start`
4. Ajouter les variables d'environnement

---

## Sources de données

| Source | Usage | Clé requise |
|--------|-------|-------------|
| [api-adresse.data.gouv.fr](https://api-adresse.data.gouv.fr) | Géocodage | ❌ Gratuite |
| [apicarto.ign.fr/api/gpu](https://apicarto.ign.fr/api/gpu) | Zone PLU | ❌ Gratuite (quota) |
| [IGN WFS Géoportail](https://geoservices.ign.fr) | Zone PLU précise | ✅ Gratuite |
| [api.anthropic.com](https://console.anthropic.com) | Analyse IA | ✅ Payante |

---

## Roadmap

- [ ] Lecture directe des PDF de règlement PLU (via URL `urlfic` du GPU)
- [ ] Module normes incendie / PMR
- [ ] Export notice PDF pour dépôt en mairie
- [ ] Historique des analyses (base de données)
- [ ] Interface mairie / marque blanche
- [ ] Support PLU internationaux

---

## ⚠️ Disclaimer

Les analyses fournies par UrbanIA sont **indicatives** et basées sur les données du Géoportail de l'Urbanisme.  
Elles ne remplacent pas une consultation auprès du service d'urbanisme de votre mairie ni un avis professionnel d'architecte.  
Vérifiez toujours les règles applicables avant tout dépôt de permis de construire ou déclaration préalable.
