// The clay edge-tab look, shared by the OWA drawer's collapse tab and the
// Gmail rail tab. Dimensions and positioning stay with each host — the two
// tabs sit in very different places — this is only the shared skin: brand
// terracotta on cream, which reads correctly against light and dark mail
// chrome alike, so neither host needs backdrop-measuring.
export const EDGE_TAB_CSS = `
.tab {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 8px 0 0 8px;
  background: #c2683f;
  color: #faf9f6;
  cursor: pointer;
  box-shadow: 0 2px 10px rgb(0 0 0 / 0.22);
}
.tab:hover { background: #b15c36; }
.tab:focus-visible { outline: 2px solid #faf9f6; outline-offset: -4px; }
`;
