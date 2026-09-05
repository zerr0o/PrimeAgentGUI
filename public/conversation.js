// Presentation only: native messages and streaming events remain unchanged.
export function createConversationRenderer({
  el,
  icon,
  markdown,
  renderTool,
  makeDetails,
  dateLabel,
  copyText,
  showReasoning,
  renderMessage,
}) {
  const turns = new Map();
  let reasoningPreference = showReasoning();
  let resetReasoning = false;
  const idOf = (message, index) => message.id || `history-${index}`;
  function reconcile(parent, nodes) {
    nodes.forEach((node, index) => {
      if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null);
    });
    while (parent.children.length > nodes.length) parent.lastElementChild.remove();
  }
  function activityPart(turn, messages) {
    const key = `activity:${messages[0].id}`;
    let part = turn.parts.get(key);
    if (!part) {
      const node = makeDetails('activity-stack', `${turn.key}:${key}`, showReasoning());
      if (resetReasoning) node.open = reasoningPreference;
      const summary = el('summary');
      const titles = el('span', 'activity-titles');
      const label = el('span', 'activity-label', 'Activité de l’agent');
      const count = el('span', 'activity-count');
      const status = el('span', 'activity-state');
      const symbol = el('span', 'activity-symbol');
      titles.append(label, count);
      summary.append(symbol, titles, status, icon('chevron', 'activity-chevron'));
      const content = el('div', 'activity-content');
      node.append(summary, content);
      part = { node, label, count, status, symbol, content, steps: new Map() };
      turn.parts.set(key, part);
    }
    const tools = messages.flatMap((m) => m.tools || []);
    const errors = tools.filter((t) => t.isError).length + messages.filter((m) => m.error).length;
    const running =
      messages.some((m) => m.streaming) || tools.some((t) => ['running', 'pending'].includes(t.status));
    const reasoning = messages.filter((m) => m.thinking).length;
    part.count.textContent =
      [
        tools.length ? `${tools.length} appel${tools.length > 1 ? 's' : ''} d’outil` : '',
        reasoning ? `${reasoning} réflexion${reasoning > 1 ? 's' : ''}` : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'Préparation…';
    part.status.textContent = errors
      ? `${errors} erreur${errors > 1 ? 's' : ''}`
      : running
        ? 'En cours'
        : 'Terminé';
    part.node.classList.toggle('has-errors', errors > 0);
    part.node.classList.toggle('is-running', running);
    const symbolState = running ? 'running' : errors ? 'error' : 'done';
    if (part.symbol.dataset.state !== symbolState) {
      part.symbol.dataset.state = symbolState;
      part.symbol.replaceChildren(running ? el('span', 'spinner') : icon(errors ? 'alert' : 'terminal'));
    }
    const keep = new Set();
    const steps = messages.map((m, index) => {
      const signature = JSON.stringify(m);
      let step = part.steps.get(m.id);
      if (!step || step.signature !== signature) {
        const node = el('div', 'activity-step');
        node.dataset.messageId = m.id;
        node.append(el('div', 'activity-step-label', `Étape ${index + 1}`));
        if (m.thinking) {
          const thinking = makeDetails('thinking-block', `thinking:${m.id}`, showReasoning());
          if (resetReasoning) thinking.open = reasoningPreference;
          const summary = el('summary');
          summary.append(icon('brain'), el('span', '', 'Raisonnement'), icon('chevron', 'chevron'));
          thinking.append(summary, el('div', 'thinking-content', m.thinking));
          node.append(thinking);
        }
        for (const tool of m.tools || []) node.append(renderTool(tool, m.id));
        if (m.error) node.append(el('div', 'message-error', m.error));
        if (!m.text && m.attachments?.length)
          node.append(
            el(
              'div',
              'attachment-note',
              `${m.attachments.length} pièce(s) jointe(s) dans la session native.`,
            ),
          );
        if (!m.thinking && !m.tools?.length && m.streaming)
          node.append(el('span', 'activity-waiting', 'L’agent prépare la prochaine étape…'));
        step = { node, signature };
        part.steps.set(m.id, step);
      }
      keep.add(m.id);
      return step.node;
    });
    reconcile(part.content, steps);
    for (const id of part.steps.keys()) if (!keep.has(id)) part.steps.delete(id);
    return { key, node: part.node };
  }
  function textPart(turn, m) {
    const key = `text:${m.id}`;
    const signature = JSON.stringify([m.text, m.error, m.attachments, m.streaming, m.stopReason]);
    let part = turn.parts.get(key);
    if (!part || part.signature !== signature) {
      const node = el('div', 'assistant-text');
      node.dataset.messageId = m.id;
      if (m.text) node.append(markdown(m.text));
      if (m.error) node.append(el('div', 'message-error', m.error));
      if (m.attachments?.length)
        node.append(
          el('div', 'attachment-note', `${m.attachments.length} pièce(s) jointe(s) dans la session native.`),
        );
      if (m.streaming) node.append(el('span', 'stream-caret'));
      if (m.text) {
        const actions = el('div', 'message-actions');
        const copy = el('button', '');
        copy.type = 'button';
        copy.append(icon('copy'), document.createTextNode('Copier'));
        copy.onclick = () => copyText(m.text, 'Message copié');
        actions.append(copy);
        node.append(actions);
      }
      if (!node.childNodes.length)
        node.append(
          el('span', '', m.stopReason === 'aborted' ? 'Réponse interrompue.' : 'Aucun contenu textuel.'),
        );
      part = { node, signature };
      turn.parts.set(key, part);
    }
    return { key, node: part.node };
  }
  function assistantTurn(messages) {
    const key = messages[0].id;
    let turn = turns.get(key);
    if (!turn) {
      const node = el('article', 'message assistant assistant-turn');
      node.dataset.messageId = key;
      const heading = el('div', 'message-heading');
      const avatar = el('span', 'message-avatar');
      avatar.append(icon('model'));
      const model = el('span', 'message-model');
      const time = el('span', 'message-time');
      heading.append(avatar, el('span', 'message-author', 'Prime Agent'), model, time);
      const body = el('div', 'message-body assistant-turn-body');
      node.append(heading, body);
      turn = { key, node, model, time, body, parts: new Map() };
      turns.set(key, turn);
    }
    const model = messages.find((m) => m.model)?.model;
    turn.model.hidden = !model;
    turn.model.textContent = model ? String(model).split('/').pop() : '';
    turn.model.title = model || '';
    turn.time.textContent = dateLabel(messages[0].timestamp);
    const parts = [];
    let activity = [];
    const flush = () => {
      if (activity.length) parts.push(activityPart(turn, activity));
      activity = [];
    };
    for (const m of messages) {
      const hasTools = m.tools?.length > 0;
      if (m.text && hasTools) {
        flush();
        parts.push(textPart(turn, { ...m, error: undefined, streaming: false }));
        activity.push(m);
      } else if (m.text) {
        if (m.thinking) activity.push({ ...m, error: undefined, streaming: false });
        flush();
        parts.push(textPart(turn, m));
      } else if (m.thinking || hasTools || m.streaming) activity.push(m);
      else {
        flush();
        parts.push(textPart(turn, m));
      }
    }
    flush();
    reconcile(
      turn.body,
      parts.map((p) => p.node),
    );
    const keep = new Set(parts.map((p) => p.key));
    for (const id of turn.parts.keys()) if (!keep.has(id)) turn.parts.delete(id);
    return turn.node;
  }
  return {
    render(root, messages) {
      if (reasoningPreference !== showReasoning()) {
        reasoningPreference = showReasoning();
        resetReasoning = true;
        turns.clear();
      }
      const nodes = [],
        activeTurns = new Set();
      let assistant = [];
      const flush = () => {
        if (assistant.length) {
          nodes.push(assistantTurn(assistant));
          activeTurns.add(assistant[0].id);
          assistant = [];
        }
      };
      messages.forEach((m, index) => {
        if (m.role === 'assistant') assistant.push({ ...m, id: idOf(m, index) });
        else {
          flush();
          nodes.push(renderMessage(m, index));
        }
      });
      flush();
      reconcile(root, nodes);
      for (const key of turns.keys()) if (!activeTurns.has(key)) turns.delete(key);
      resetReasoning = false;
    },
  };
}
