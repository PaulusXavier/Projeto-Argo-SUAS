// Fonte única de dados da equipe técnica do CRAS Cristiana Vicente Nunes.
// Usado tanto pelo app principal (app.js, objeto "atendimento-cras") quanto
// pelo painel avulso (Divisão_Territorial___Equipe_Técnica_-_CRAS_Cristiana.html).
// Ao trocar um técnico de bairro, ou a equipe, edite SOMENTE este arquivo —
// as duas telas são atualizadas automaticamente a partir daqui.
const EQUIPE_CRAS_CRISTIANA = {
  fixedTeam: [
    { name: "Fernanda Gomes", role: "Psicóloga", bairros: "Buritis e Caimbé" },
    { name: "Cléo Sousa", role: "Assistente Social", bairros: "Liberdade e Pricumã" },
    { name: "Bárbara Parente", role: "Assistente Social", bairros: "Tancredo Neves, Cambará e Olímpico" },
    { name: "Susy Andrade", role: "Pedagoga", bairros: "Centenário e Nova Canaã" },
    { name: "Paloma de Assis", role: "Assistente Social", bairros: "Cinturão Verde e Jóquei Clube" },
    { name: "Rafaela Garcia", role: "Assistente Social", bairros: "Asa Branca" }
  ],
  fixedCoverage: ["13 de Setembro", "Asa Branca", "Buritis", "Caimbé", "Cambará", "Centenário", "Cinturão Verde", "Jóquei Clube", "Liberdade", "Marechal Rondon", "Nova Canaã", "Olímpico", "Pricumã", "Araceli Souto Maior", "Tancredo Neves"],
  volanteTeam: [
    { name: "Keomara Teles", role: "Assistente Social", note: "Atendimento Itinerante" },
    { name: "Danilo Braga", role: "Psicólogo", note: "Atendimento Itinerante" },
    { name: "Paulo Xavier", role: "Psicólogo", note: "Atendimento Itinerante" }
  ],
  volanteDesc: "Responsável por levar serviços (PAIF, CadÚnico) a áreas de difícil acesso e populações dispersas.",
  volanteCoverage: "Professora Araceli Souto Maior, 13 de Setembro e Ocupação Nova Vida."
};
