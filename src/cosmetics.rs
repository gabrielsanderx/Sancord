//! Perfil — catálogo de cosméticos e posse (fonte de verdade no servidor).
//!
//! Modelo (seções 59, 64–66 e 72 do pedido de perfis):
//! - `CosmeticItem`: id, tipo, nome, coleção, raridade, animado e disponibilidade.
//! - Disponibilidade não é pagamento: "free" (todos), "badge:<id>" (quem tem a badge,
//!   concedida só pelo servidor), "grant" (só por inventário: eventos, presentes, códigos).
//! - Posse = gratuito, ou id em `Account.inventory`, ou badge exigida em `profile.badges`.
//! - O cliente desenha cada item pelo `id` (arte própria em CSS/SVG); o servidor só
//!   aceita equipar o que existe, é do tipo certo e a pessoa possui.
use crate::models::Account;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    AvatarDecoration,
    ProfileFrame,
    ProfileEffect,
    Nameplate,
    NameStyle,
}

#[derive(Debug, Clone, Serialize)]
pub struct CosmeticItem {
    pub id: &'static str,
    pub kind: Kind,
    pub name: &'static str,
    pub collection: &'static str,
    /// "common" | "rare" | "epic" | "legendary" | "event" | "founder"
    pub rarity: &'static str,
    pub animated: bool,
    /// "free" | "badge:<id>" | "grant"
    pub availability: &'static str,
}

const fn item(id: &'static str, kind: Kind, name: &'static str, collection: &'static str, rarity: &'static str, animated: bool, availability: &'static str) -> CosmeticItem {
    CosmeticItem { id, kind, name, collection, rarity, animated, availability }
}

use Kind::*;

/// Biblioteca Curada V5 — Coleções Flagship Autorais de Arte Pintada do Sanvo.
/// Qualidade acima de quantidade (#23, #57):
/// • 4 Avatar Decorations flagship em camadas WebP HiDPI pintadas (`BACK` + `AVATAR` + `FRONT` + `BLINK/FX`)
/// • 4 Profile Frames flagship assimétricas pintadas (`TL` + `TR` + `BR`) + 4 Conquistas/Temporada exclusivas
/// • 4 Profile Effects narrativos em 4 atos com sprites WebP pintados e coordenação de moldura
/// • 4 Nameplates coordenadas por coleção + 26 Estilos & Fontes de Nome
const V5_AVATAR_DECORATIONS: &[CosmeticItem] = &[
    item("galaxy-portal", AvatarDecoration, "Astrolábio Celestial", "cosmic", "legendary", true, "free"),
    item("sakura-glow", AvatarDecoration, "Ramo de Hanami", "sakura", "epic", true, "free"),
    item("frost-crown", AvatarDecoration, "Dragão Glacial", "frost", "legendary", true, "free"),
    item("cat-gamer", AvatarDecoration, "Kitsune-Neko Cyber", "cyber", "legendary", true, "free"),
    item("dragon-fire", AvatarDecoration, "Chamas de Drakon", "inferno", "legendary", true, "free"),
    item("blood-moon", AvatarDecoration, "Oráculo do Eclipse", "arcane", "legendary", true, "free"),
    item("ocean-bubbles", AvatarDecoration, "Coroa das Profundezas", "abyssal", "epic", true, "free"),
    item("angel-wings", AvatarDecoration, "Asas de Serafim", "seraphim", "legendary", true, "free"),
    item("lunar", AvatarDecoration, "Guardião das Borboletas", "dream", "legendary", true, "free"),
    item("electric-pulse", AvatarDecoration, "Espírito Raijin", "synth", "legendary", true, "free"),
    item("cyber-ring", AvatarDecoration, "Companheiro Pixel-Bot", "retro", "epic", true, "free"),
    item("core-orbit", AvatarDecoration, "Koi de Jade & Ouro", "royal", "legendary", true, "free"),
    item("eclipse-sovereign", AvatarDecoration, "Coroa do Soberano", "conquistas", "founder", true, "badge:sovereign"),
];

const V5_PROFILE_FRAMES: &[CosmeticItem] = &[
    item("cosmic-drift", ProfileFrame, "Observatório Astralium", "cosmic", "legendary", true, "free"),
    item("sakura-wind", ProfileFrame, "Jardim de Hanami", "sakura", "epic", true, "free"),
    item("frost-glint", ProfileFrame, "Cidadela de Glacium", "frost", "legendary", true, "free"),
    item("holographic", ProfileFrame, "Chassi Synth-Neko", "cyber", "legendary", true, "free"),
    item("ember-trail", ProfileFrame, "Forja de Drakon", "inferno", "legendary", true, "free"),
    item("arcane-grimoire", ProfileFrame, "Grimório Arcano", "arcane", "legendary", true, "free"),
    item("liquid", ProfileFrame, "Santuário Abissal", "abyssal", "epic", true, "free"),
    item("seraphim-arch", ProfileFrame, "Arco de Serafim", "seraphim", "legendary", true, "free"),
    item("dream-sanctuary", ProfileFrame, "Bosque Onírico", "dream", "legendary", true, "free"),
    item("neon-pulse", ProfileFrame, "Templo do Trovão", "synth", "legendary", true, "free"),
    item("eclipse-crown", ProfileFrame, "Gabinete Arcade", "retro", "epic", true, "free"),
    item("core-pulse", ProfileFrame, "Lagoa de Jade", "royal", "legendary", true, "free"),
    item("sovereign-crest", ProfileFrame, "Trono Soberano", "conquistas", "founder", true, "badge:sovereign"),
    item("early-user", ProfileFrame, "Pioneira Astral", "conquistas", "founder", false, "badge:early_user"),
    item("founder", ProfileFrame, "Fundação Imperial", "conquistas", "founder", true, "badge:founder"),
    item("developer", ProfileFrame, "Arquitetura Dev", "conquistas", "legendary", true, "badge:developer"),
    item("winter-2026", ProfileFrame, "Solstício Glacial", "temporada-inverno", "event", true, "grant"),
];

const V5_PROFILE_EFFECTS: &[CosmeticItem] = &[
    item("star-trail", ProfileEffect, "Eclipse da Nebulosa", "cosmic", "legendary", true, "free"),
    item("petal-drift", ProfileEffect, "Rajada de Cerejeira", "sakura", "epic", true, "free"),
    item("polar-ribbon", ProfileEffect, "Tempestade Polar", "frost", "legendary", true, "free"),
    item("circuit-boot", ProfileEffect, "Inicialização Holográfica", "cyber", "legendary", true, "free"),
    item("embers", ProfileEffect, "Erupção de Brasas", "inferno", "legendary", true, "free"),
    item("arcane-sigil", ProfileEffect, "Selo do Eclipse", "arcane", "legendary", true, "free"),
    item("abyssal-tide", ProfileEffect, "Maré Bioluminescente", "abyssal", "epic", true, "free"),
    item("seraphim-fall", ProfileEffect, "Chuva de Plumas", "seraphim", "legendary", true, "free"),
    item("dream-butterflies", ProfileEffect, "Revoada Onírica", "dream", "legendary", true, "free"),
    item("synth-overdrive", ProfileEffect, "Fúria de Raijin", "synth", "legendary", true, "free"),
    item("eclipse-flare", ProfileEffect, "Overdrive Arcade", "retro", "epic", true, "free"),
    item("core-signal", ProfileEffect, "Dança dos Koi", "royal", "legendary", true, "free"),
];

const V5_NAMEPLATES: &[CosmeticItem] = &[
    item("starlit-silt", Nameplate, "Constelação Astralium", "cosmic", "epic", true, "free"),
    item("twilight-garden", Nameplate, "Ramo de Hanami", "sakura", "epic", true, "free"),
    item("frost-vein", Nameplate, "Cristais de Glacium", "frost", "epic", false, "free"),
    item("core-stripe", Nameplate, "Pulso Synth-Neko", "cyber", "epic", true, "free"),
    item("ember-line", Nameplate, "Veio de Brasa", "inferno", "epic", true, "free"),
    item("arcane-velvet", Nameplate, "Veludo Arcano", "arcane", "epic", true, "free"),
    item("tide-glass", Nameplate, "Vidro de Maré", "abyssal", "epic", true, "free"),
    item("eclipse-gold", Nameplate, "Ouro de Serafim", "seraphim", "legendary", true, "free"),
    item("dream-mist", Nameplate, "Bruma Onírica", "dream", "epic", true, "free"),
    item("circuit-weave", Nameplate, "Corrente de Raijin", "synth", "epic", false, "free"),
    item("gold-leaf", Nameplate, "Lótus de Jade & Ouro", "royal", "legendary", false, "free"),
];

const V4_NAME_STYLES: &[CosmeticItem] = &[
    item("gta", NameStyle, "Cursiva Vice", "classicos", "common", false, "free"),
    item("neon", NameStyle, "Neon Nítido", "synth", "rare", true, "free"),
    item("chrome", NameStyle, "Cromado", "cyber", "rare", true, "free"),
    item("gradient", NameStyle, "Arco-íris Fluido", "sancord-core", "rare", true, "free"),
    item("fire", NameStyle, "Chamas", "inferno", "common", false, "free"),
    item("ice", NameStyle, "Cristal Glacial", "frost", "common", false, "free"),
    item("sakura", NameStyle, "Rosa Sakura", "sakura", "rare", true, "free"),
    item("retro", NameStyle, "Pixel Retrô", "retro", "common", false, "free"),
    item("gothic", NameStyle, "Gótico", "royal", "common", false, "free"),
    item("toxic", NameStyle, "Ácido Neon", "cyber", "common", false, "free"),
    item("royal", NameStyle, "Ouro Imperial", "royal", "rare", true, "free"),
    item("modern", NameStyle, "Moderno", "sancord-core", "common", false, "free"),
    item("rounded", NameStyle, "Arredondado", "sancord-core", "common", false, "free"),
    item("mono", NameStyle, "Monoespaçado", "cyber", "common", false, "free"),
    item("editorial", NameStyle, "Editorial", "royal", "common", false, "free"),
    item("bubble", NameStyle, "Pop Bubble", "sakura", "common", false, "free"),
    item("cyber", NameStyle, "Cyber Tech", "cyber", "rare", false, "free"),
    item("fantasy", NameStyle, "Fantasia", "arcane", "rare", false, "free"),
    item("outline", NameStyle, "Contorno Artístico", "sancord-core", "common", false, "free"),
    item("glow", NameStyle, "Brilho Suave", "cosmic", "rare", true, "free"),
    item("prism", NameStyle, "Prismático", "cosmic", "epic", true, "free"),
    item("holographic", NameStyle, "Holográfico", "cyber", "epic", true, "free"),
    item("gummy", NameStyle, "Gel Gummy", "sakura", "rare", false, "free"),
    item("ink", NameStyle, "Tinta Artística", "retro", "rare", false, "free"),
    item("cosmic", NameStyle, "Cósmico Fluido", "cosmic", "epic", true, "free"),
    item("custom-gradient", NameStyle, "Gradiente Personalizado", "sancord-core", "rare", true, "free"),
];

/// IDs legados gratuitos retirados da vitrine V5, mas ainda aceitos no backend para
/// compatibilidade transparente com contas e presets antigos (o cliente renderiza o sucessor V5).
const LEGACY_FREE_IDS: &[(Kind, &str)] = &[
    (AvatarDecoration, "static-royal-crown"),
    (AvatarDecoration, "static-emerald"), (AvatarDecoration, "static-cyber-hud"), (AvatarDecoration, "static-diamond"),
    (AvatarDecoration, "flame-violet"), (AvatarDecoration, "devil-horns"), (AvatarDecoration, "cyber-cyan"),
    (AvatarDecoration, "golden-halo"), (AvatarDecoration, "crimson-vortex"), (AvatarDecoration, "rainbow-prism"),
    (AvatarDecoration, "electric-surge"), (AvatarDecoration, "heart-pixel"), (AvatarDecoration, "neon-glitch"),
    (AvatarDecoration, "nebula-orbit"), (AvatarDecoration, "sakura-fall"), (AvatarDecoration, "ember"),
    (AvatarDecoration, "snowfall"), (AvatarDecoration, "digital-rain"), (AvatarDecoration, "retro-pixels"),
    (AvatarDecoration, "static-gold"), (AvatarDecoration, "static-crimson"), (AvatarDecoration, "static-blurple"),
    (AvatarDecoration, "static-angel"),
    (ProfileFrame, "reactive-aura"),
    (ProfileFrame, "voice-pulse"), (ProfileFrame, "royal"), (ProfileFrame, "cyber-corners"), (ProfileFrame, "minimal"),
    (ProfileFrame, "carbon"), (ProfileFrame, "sakura-corners"), (ProfileFrame, "retro-pixel"),
    (ProfileFrame, "cosmic"), (ProfileFrame, "inferno"), (ProfileFrame, "frost"),
    (ProfileFrame, "prism-flow"), (ProfileFrame, "electric"), (ProfileFrame, "digital-glitch"),
    (ProfileEffect, "sparkles"), (ProfileEffect, "sakura"), (ProfileEffect, "matrix"),
    (ProfileEffect, "lightning"), (ProfileEffect, "snow"), (ProfileEffect, "confetti"),
    (ProfileEffect, "cyber"), (ProfileEffect, "hellfire"), (ProfileEffect, "galaxy"),
    (ProfileEffect, "glitch"), (ProfileEffect, "aurora"), (ProfileEffect, "pixel-assembly"),
    (ProfileEffect, "gravity-well"),
    (Nameplate, "crimson"), (Nameplate, "nebula"), (Nameplate, "aurora"), (Nameplate, "sakura"),
    (Nameplate, "gold"), (Nameplate, "cyber"), (Nameplate, "hellfire"), (Nameplate, "frost"),
    (Nameplate, "void"), (Nameplate, "toxic"), (Nameplate, "synthwave"), (Nameplate, "retro-horizon"),
];

static CATALOG: OnceLock<Vec<CosmeticItem>> = OnceLock::new();

/// Catálogo oficial V5 exibido na vitrine do cliente.
pub fn catalog() -> &'static [CosmeticItem] {
    CATALOG.get_or_init(|| {
        V5_AVATAR_DECORATIONS
            .iter()
            .chain(V5_PROFILE_FRAMES)
            .chain(V5_PROFILE_EFFECTS)
            .chain(V5_NAMEPLATES)
            .chain(V4_NAME_STYLES)
            .cloned()
            .collect()
    })
}

/// Badges oficiais. "trust" = confirmação/confiança (sempre visíveis, nunca confundidas com
/// cosmético); "cosmetic" = lembranças. Só o servidor concede.
/// `can_hide` indica se o titular pode ocultar a badge da exibição do perfil (badges de sistema/bot
/// obrigatórias podem definir `can_hide: false`).
#[derive(Debug, Clone, Serialize)]
pub struct BadgeDef {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub can_hide: bool,
}

/// Limite máximo de badges exibidas simultaneamente no perfil público.
pub const MAX_VISIBLE_BADGES: usize = 6;

pub const BADGES: &[BadgeDef] = &[
    BadgeDef { id: "founder", name: "Fundador do Sanvo", category: "trust", description: "Fundador oficial do projeto Sanvo.", can_hide: true },
    BadgeDef { id: "architect", name: "Arquiteto do Sanvo", category: "trust", description: "Idealizador e arquiteto principal do ecossistema Sanvo.", can_hide: true },
    BadgeDef { id: "developer", name: "Desenvolvimento", category: "trust", description: "Faz parte da equipe de desenvolvimento.", can_hide: true },
    BadgeDef { id: "moderator", name: "Moderação oficial", category: "trust", description: "Modera a comunidade oficial.", can_hide: true },
    BadgeDef { id: "verified_bot", name: "Bot verificado", category: "trust", description: "Integração verificada pelo Sanvo.", can_hide: false },
    BadgeDef { id: "verified_developer", name: "Dev verificado", category: "trust", description: "Desenvolvedor de integração verificado.", can_hide: true },
    BadgeDef { id: "contributor", name: "Contribuição", category: "trust", description: "Contribuiu com código, tradução ou documentação.", can_hide: true },
    BadgeDef { id: "bug_hunter", name: "Caça-Bugs", category: "trust", description: "Ajudou a encontrar problemas importantes.", can_hide: true },
    BadgeDef { id: "event_winner", name: "Vencedora de evento", category: "trust", description: "Venceu um evento oficial.", can_hide: true },
    BadgeDef { id: "sovereign", name: "Soberano Imperial", category: "cosmetic", description: "Insígnia exclusiva de prestígio supremo no Sanvo.", can_hide: true },
    BadgeDef { id: "astral_guardian", name: "Guardião Astralium", category: "cosmetic", description: "Portador da relíquia original da coleção Astralium.", can_hide: true },
    BadgeDef { id: "dragon_forged", name: "Forjado em Drakon", category: "cosmetic", description: "Distinção rara da Forja Dracônica.", can_hide: true },
    BadgeDef { id: "prism_collector", name: "Colecionador Prismático", category: "cosmetic", description: "Colecionador lendário de cosméticos flagship do Sanvo.", can_hide: true },
    BadgeDef { id: "obsidian_vip", name: "Núcleo Obsidiana", category: "cosmetic", description: "Membro exclusivo do círculo fechado Obsidiana.", can_hide: true },
    BadgeDef { id: "early_user", name: "Pioneira", category: "cosmetic", description: "Conta criada na fase inicial do Sanvo.", can_hide: true },
    BadgeDef { id: "alpha", name: "Alpha", category: "cosmetic", description: "Participou do Alpha.", can_hide: true },
    BadgeDef { id: "beta", name: "Beta", category: "cosmetic", description: "Participou do Beta.", can_hide: true },
    BadgeDef { id: "community", name: "Comunidade", category: "cosmetic", description: "Reconhecimento da comunidade.", can_hide: true },
    BadgeDef { id: "supporter", name: "Apoio inicial", category: "cosmetic", description: "Apoiou o Sanvo no início.", can_hide: true },
];

pub fn badge(id: &str) -> Option<&'static BadgeDef> {
    BADGES.iter().find(|b| b.id == id)
}

/// Contas criadas antes desta data ganham "early_user" automaticamente (fase inicial).
pub const EARLY_USER_CUTOFF: (i32, u32, u32) = (2027, 1, 1);

/// "18/11/2026" (formato salvo em `created_at`) → (ano, mês, dia).
fn parse_pt_date(s: &str) -> Option<(i32, u32, u32)> {
    let mut it = s.trim().split(|c: char| c == '/' || c.is_whitespace());
    let d: u32 = it.next()?.parse().ok()?;
    let m: u32 = it.next()?.parse().ok()?;
    let y: i32 = it.next()?.parse().ok()?;
    Some((y, m, d))
}

/// Todas as badges realmente possuídas pela conta (concedidas pelo operador + automáticas),
/// em ordem canônica de `BADGES`. O cliente nunca altera esta lista.
pub fn owned_badges(acc: &Account, granted: &[String]) -> Vec<String> {
    let mut set: Vec<String> = granted.iter().filter(|b| badge(b).is_some()).cloned().collect();
    // Sem data legível (contas muito antigas) também conta como fase inicial.
    let early = acc.created_at.as_deref().and_then(parse_pt_date).map_or(true, |(y, m, d)| (y, m, d) < EARLY_USER_CUTOFF);
    if early {
        set.push("early_user".into());
    }
    BADGES.iter().filter(|b| set.iter().any(|s| s == b.id)).map(|b| b.id.to_string()).collect()
}

/// Lista de badges possuídas pela conta em memória (com fallback seguro para `acc.profile.badges`
/// em testes que constroem `Account` manualmente).
pub fn account_owned_badges(acc: &Account) -> &[String] {
    if !acc.owned_badges.is_empty() {
        &acc.owned_badges
    } else {
        &acc.profile.badges
    }
}

/// Aplica ordem e ocultação do usuário sobre as badges realmente possuídas (`owned`):
/// - Só inclui IDs presentes em `owned` (nunca concede badges novas).
/// - Novas badges conquistadas fora de `badge_order` entram automaticamente ao final se não estiverem ocultas.
/// - Badges com `can_hide == false` permanecem sempre visíveis.
/// - Limita a exibição total a `MAX_VISIBLE_BADGES` (ou mais apenas se houver mais badges obrigatórias).
pub fn resolve_visible_badges(
    owned: &[String],
    badge_order: &[String],
    hidden_badges: &[String],
) -> Vec<String> {
    let mut ordered: Vec<String> = Vec::with_capacity(owned.len());
    for id in badge_order {
        if owned.iter().any(|o| o == id) && !ordered.iter().any(|x| x == id) {
            ordered.push(id.clone());
        }
    }
    for id in owned {
        if !ordered.iter().any(|x| x == id) {
            ordered.push(id.clone());
        }
    }

    let mut mandatory: Vec<&str> = Vec::new();
    let mut optional: Vec<&str> = Vec::new();
    for id in &ordered {
        let can_hide = badge(id).map_or(true, |def| def.can_hide);
        if !can_hide {
            mandatory.push(id.as_str());
        } else if !hidden_badges.iter().any(|h| h == id) {
            optional.push(id.as_str());
        }
    }
    let remaining_slots = MAX_VISIBLE_BADGES.saturating_sub(mandatory.len());
    let allowed_optional: std::collections::HashSet<&str> =
        optional.into_iter().take(remaining_slots).collect();
    let mandatory_set: std::collections::HashSet<&str> = mandatory.into_iter().collect();

    ordered
        .iter()
        .filter(|id| mandatory_set.contains(id.as_str()) || allowed_optional.contains(id.as_str()))
        .cloned()
        .collect()
}

/// Sanitiza as preferências de ordem e ocultação enviadas pelo cliente:
/// intersecta estritamente com `owned`, remove duplicatas e ignora tentativas de ocultar badges obrigatórias.
pub fn sanitize_badge_preferences(
    owned: &[String],
    requested_order: Option<Vec<String>>,
    requested_hidden: Option<Vec<String>>,
    current_order: &[String],
    current_hidden: &[String],
) -> (Vec<String>, Vec<String>) {
    let next_order = match requested_order {
        Some(req) => {
            let mut out = Vec::new();
            for raw in req {
                let id = raw.trim();
                if owned.iter().any(|o| o == id) && !out.iter().any(|x| x == id) {
                    out.push(id.to_string());
                }
            }
            out
        }
        None => current_order
            .iter()
            .filter(|id| owned.iter().any(|o| o == *id))
            .cloned()
            .collect(),
    };
    let next_hidden = match requested_hidden {
        Some(req) => {
            let mut out = Vec::new();
            for raw in req {
                let id = raw.trim();
                if owned.iter().any(|o| o == id)
                    && badge(id).is_some_and(|def| def.can_hide)
                    && !out.iter().any(|x| x == id)
                {
                    out.push(id.to_string());
                }
            }
            out
        }
        None => current_hidden
            .iter()
            .filter(|id| owned.iter().any(|o| o == *id) && badge(id).is_some_and(|def| def.can_hide))
            .cloned()
            .collect(),
    };
    (next_order, next_hidden)
}

/// Atualiza simultaneamente `acc.owned_badges` e `acc.profile.badges` (exibição efetiva).
pub fn sync_account_badges(acc: &mut Account, granted: &[String]) {
    let owned = owned_badges(acc, granted);
    acc.owned_badges = owned.clone();
    acc.profile.badges = resolve_visible_badges(&owned, &acc.badge_order, &acc.hidden_badges);
}

/// Badges efetivas exibidas no perfil = badges possuídas + preferências de ordem/visibilidade.
pub fn effective_badges(acc: &Account, granted: &[String]) -> Vec<String> {
    let owned = owned_badges(acc, granted);
    resolve_visible_badges(&owned, &acc.badge_order, &acc.hidden_badges)
}

/// Lê `badges.json` ({"usuario": ["founder", ...]}) da pasta de dados. Ausente ou inválido = vazio.
pub fn load_badge_grants(data_dir: &std::path::Path) -> std::collections::HashMap<String, Vec<String>> {
    std::fs::read_to_string(data_dir.join("badges.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<std::collections::HashMap<String, Vec<String>>>(&s).ok())
        .map(|m| m.into_iter().map(|(k, v)| (k.to_lowercase(), v)).collect())
        .unwrap_or_default()
}

/// Persiste `badges.json` de forma atômica (arquivo temporário + rename), omitindo contas sem selos manuais.
pub fn save_badge_grants(
    data_dir: &std::path::Path,
    grants: &std::collections::HashMap<String, Vec<String>>,
) -> std::io::Result<()> {
    std::fs::create_dir_all(data_dir)?;
    let cleaned: std::collections::BTreeMap<&String, &Vec<String>> = grants
        .iter()
        .filter(|(_, list)| !list.is_empty())
        .collect();
    let json = serde_json::to_string_pretty(&cleaned)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let target = data_dir.join("badges.json");
    let tmp = data_dir.join("badges.json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// Conta autorizada a gerenciar selos via painel administrativo:
/// possui badge `founder`/`developer` ou está listada em `SANCORD_OPERATORS`.
pub fn is_badge_operator(acc: &Account) -> bool {
    if account_owned_badges(acc)
        .iter()
        .any(|b| matches!(b.as_str(), "founder" | "developer"))
    {
        return true;
    }
    if let Ok(raw) = std::env::var("SANCORD_OPERATORS") {
        let lower = acc.username.to_lowercase();
        return raw
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .any(|op| !op.is_empty() && op == lower);
    }
    false
}

pub fn find(kind: Kind, id: &str) -> Option<&'static CosmeticItem> {
    catalog().iter().find(|i| i.kind == kind && i.id == id)
}

pub fn owns(acc: &Account, item: &CosmeticItem) -> bool {
    match item.availability {
        "free" => true,
        a => {
            if let Some(badge) = a.strip_prefix("badge:") {
                if account_owned_badges(acc).iter().any(|b| b == badge) {
                    return true;
                }
            }
            acc.inventory.iter().any(|i| i == &inventory_key(item))
        }
    }
}

/// Chave no inventário: "tipo:id" (ids podem repetir entre tipos, ex.: "sakura").
pub fn inventory_key(item: &CosmeticItem) -> String {
    format!("{}:{}", kind_name(item.kind), item.id)
}

pub fn kind_name(kind: Kind) -> &'static str {
    match kind {
        AvatarDecoration => "avatar_decoration",
        ProfileFrame => "profile_frame",
        ProfileEffect => "profile_effect",
        Nameplate => "nameplate",
        NameStyle => "name_style",
    }
}

const NAME_FONTS: &[&str] = &["gta", "retro", "gothic", "modern", "rounded", "mono", "editorial", "bubble", "cyber", "fantasy"];

/// Valor pedido pelo cliente para equipar: `Ok(None)` = tirar; `Ok(Some(id))` = equipar.
/// "none", "default" e vazio tiram o item.
pub fn check_equip(acc: &Account, kind: Kind, requested: &str) -> Result<Option<String>, &'static str> {
    let id = requested.trim();
    if id.is_empty() || id == "none" || id == "default" {
        return Ok(None);
    }
    if let (Kind::NameStyle, Some((font, effect))) = (kind, id.split_once('+')) {
        if (font, effect) == ("default", "default") {
            return Ok(Some(id.to_string()));
        }
        if !NAME_FONTS.contains(&font) || NAME_FONTS.contains(&effect) {
            return Err("Escolha uma fonte e um efeito válidos para o nome.");
        }
        let font = find(kind, font).ok_or("Esta fonte não existe no catálogo do Sanvo.")?;
        let effect = find(kind, effect).ok_or("Este efeito de nome não existe no catálogo do Sanvo.")?;
        if !owns(acc, font) || !owns(acc, effect) {
            return Err("Você ainda não possui este item.");
        }
        return Ok(Some(id.to_string()));
    }
    if let Some(item) = find(kind, id) {
        if !owns(acc, item) {
            return Err("Você ainda não possui este item.");
        }
        return Ok(Some(item.id.to_string()));
    }
    if LEGACY_FREE_IDS.iter().any(|&(k, legacy)| k == kind && legacy == id) {
        return Ok(Some(id.to_string()));
    }
    Err("Este item não existe no catálogo do Sanvo.")
}

/// Verifica se a conta possui a chave `"tipo:id"` (incluindo aliases legados gratuitos).
pub fn owns_key(acc: &Account, key: &str) -> bool {
    let Some((k_str, id)) = key.split_once(':') else {
        return false;
    };
    if catalog()
        .iter()
        .any(|item| kind_name(item.kind) == k_str && item.id == id && owns(acc, item))
    {
        return true;
    }
    LEGACY_FREE_IDS
        .iter()
        .any(|&(k, legacy)| kind_name(k) == k_str && legacy == id)
}

/// Chaves de inventário que a conta possui (gratuitos + aliases legados inclusos), para o cliente filtrar.
pub fn owned_keys(acc: &Account) -> Vec<String> {
    let mut keys: Vec<String> = catalog().iter().filter(|i| owns(acc, i)).map(inventory_key).collect();
    for &(kind, id) in LEGACY_FREE_IDS {
        let key = format!("{}:{id}", kind_name(kind));
        if !keys.iter().any(|k| k == &key) {
            keys.push(key);
        }
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn badge_dates_and_order() {
        assert_eq!(parse_pt_date("18/11/2026"), Some((2026, 11, 18)));
        assert_eq!(parse_pt_date("x"), None);
        // Toda moldura de conquista aponta para uma badge que existe.
        for i in catalog() {
            if let Some(b) = i.availability.strip_prefix("badge:") {
                assert!(badge(b).is_some(), "badge inexistente: {b}");
            }
        }
        // Confiança antes de cosmética.
        let first_cosmetic = BADGES.iter().position(|b| b.category == "cosmetic").unwrap();
        assert!(BADGES[..first_cosmetic].iter().all(|b| b.category == "trust"));
    }

    #[test]
    fn catalog_ids_are_unique_per_kind_and_safe() {
        let mut seen = std::collections::HashSet::new();
        for i in catalog() {
            assert!(seen.insert((kind_name(i.kind), i.id)), "repetido: {}", i.id);
            assert!(i.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'), "id inseguro: {}", i.id);
            assert!(matches!(i.rarity, "common" | "rare" | "epic" | "legendary" | "event" | "founder"));
            assert!(i.availability == "free" || i.availability == "grant" || i.availability.starts_with("badge:"));
        }
    }

    #[test]
    fn badge_visibility_order_cap_and_security() {
        let owned: Vec<String> = vec![
            "founder", "developer", "moderator", "verified_bot",
            "contributor", "bug_hunter", "early_user", "alpha",
        ].into_iter().map(String::from).collect();

        // Sanitização descarta badges não possuídas e impede ocultar badge obrigatória (verified_bot).
        let (order, hidden) = sanitize_badge_preferences(
            &owned,
            Some(vec!["alpha".into(), "event_winner".into(), "founder".into(), "alpha".into()]),
            Some(vec!["developer".into(), "verified_bot".into(), "supporter".into()]),
            &[],
            &[],
        );
        assert_eq!(order, vec!["alpha", "founder"]);
        assert_eq!(hidden, vec!["developer"]);

        // Resolução preserva ordem personalizada, inclui novas badges automaticamente, mantém obrigatória e aplica limite 6.
        let visible = resolve_visible_badges(&owned, &order, &hidden);
        assert_eq!(visible.len(), MAX_VISIBLE_BADGES);
        assert_eq!(visible[0], "alpha");
        assert_eq!(visible[1], "founder");
        assert!(visible.contains(&"verified_bot".to_string()));
        assert!(!visible.contains(&"developer".to_string()));
    }

    #[test]
    fn exclusive_sovereign_badges_and_cosmetics_require_server_grant() {
        for id in ["architect", "sovereign", "astral_guardian", "dragon_forged", "prism_collector", "obsidian_vip"] {
            assert!(badge(id).is_some(), "insígnia exclusiva ausente: {id}");
        }
        let regular: Account = serde_json::from_value(serde_json::json!({
            "id": "1", "username": "Comum", "password_hash": "x", "avatar_color": "#5865f2"
        })).unwrap();
        assert!(check_equip(&regular, AvatarDecoration, "eclipse-sovereign").is_err());
        assert!(check_equip(&regular, ProfileFrame, "sovereign-crest").is_err());

        let mut owner: Account = serde_json::from_value(serde_json::json!({
            "id": "2", "username": "Swag", "password_hash": "x", "avatar_color": "#2563eb"
        })).unwrap();
        sync_account_badges(&mut owner, &["sovereign".into()]);
        assert_eq!(
            check_equip(&owner, AvatarDecoration, "eclipse-sovereign").unwrap(),
            Some("eclipse-sovereign".into())
        );
        assert_eq!(
            check_equip(&owner, ProfileFrame, "sovereign-crest").unwrap(),
            Some("sovereign-crest".into())
        );
    }
}
