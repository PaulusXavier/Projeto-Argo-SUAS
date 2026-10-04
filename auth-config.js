/* =====================================================================
   auth-config.js — configuração da senha do Argo SUAS.

   Este é o ÚNICO arquivo que muda quando você ativa/troca a senha forte.
   Para ativar: abra "gerar-senha-forte.html" (no seu computador, offline),
   digite a senha, e substitua este arquivo pelo auth-config.js que a
   página gerar. Depois é só publicar (push) normalmente.

   Enquanto "strong" for null, o app usa o formato ANTIGO (legacyHash,
   SHA-256 simples), que é fraco: quem baixar o site pode testar bilhões de
   senhas por segundo contra ele. Com "strong" preenchido, o legacyHash
   deixa de existir no arquivo e a verificação passa a usar PBKDF2.
   ===================================================================== */
window.ARGO_AUTH_CONFIG = {
  legacyHash: '0a94e7ea0d2d585c64b206eeadaf4327045bc5398774fe04d8b9605b299e7431',
  strong: null
};
