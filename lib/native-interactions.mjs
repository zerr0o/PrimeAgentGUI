// Ephemeral projection of Prime Agent's pending dialogs. The native tool call
// remains the authority; replies are confirmed before they are shown as sent.
export function createNativeInteractions({ emit, send }) {
  const requests = new Map();
  const acknowledgements = new Map();
  let toolId, toolName, toolOptions;
  function publish(request) {
    emit({ kind: 'interaction', request: { ...request, responding: undefined } });
  }
  function closeFor(id) {
    for (const request of requests.values())
      if ((!id || request.toolId === id) && request.status === 'pending' && !request.responding) {
        request.status = 'cancelled';
        publish(request);
      }
  }
  return {
    consume(event) {
      if (event.type === 'tool_execution_start') {
        toolId = event.toolCallId;
        toolName = event.toolName;
        toolOptions = toolName === 'question' ? event.args?.options : undefined;
      }
      if (event.type === 'tool_execution_end') {
        closeFor(event.toolCallId);
        if (toolId === event.toolCallId) {
          toolId = undefined;
          toolName = undefined;
          toolOptions = undefined;
        }
      }
      if (
        event.type === 'extension_ui_request' &&
        ['select', 'input', 'confirm', 'editor'].includes(event.method)
      ) {
        const request = {
          id: event.id,
          method: event.method,
          title: event.title,
          options: event.options,
          // Keep the native select values unchanged; descriptions are display metadata.
          optionDetails: event.options?.map((value, index) => {
            const option = Array.isArray(toolOptions) ? toolOptions[index] : undefined;
            if (!option || typeof option.label !== 'string') return null;
            const description = typeof option.description === 'string' ? option.description : '';
            const expected = `${index + 1}. ${option.label}${description ? ` — ${description}` : ''}`;
            return value === expected ? { label: option.label, description } : null;
          }),
          message: event.message,
          placeholder: event.placeholder,
          prefill: event.prefill,
          toolId,
          status: 'pending',
          createdAt: Date.now(),
          timeout: event.timeout,
        };
        request.allowCustom = toolName === 'question';
        requests.set(request.id, request);
        publish(request);
        return true;
      }
      if (event.type === 'response' && event.command === 'extension_ui_response') {
        const pending = acknowledgements.get(event.id);
        if (pending) {
          acknowledgements.delete(event.id);
          event.success
            ? pending.resolve()
            : pending.reject(new Error('La demande a expiré ou a déjà reçu une réponse.'));
        }
        return true;
      }
      return false;
    },
    async respond(id, response) {
      const request = requests.get(id);
      if (!request || request.status !== 'pending' || request.responding)
        throw new Error('Cette demande n’attend plus de réponse.');
      if (!response || typeof response !== 'object' || Array.isArray(response))
        throw new Error('Réponse invalide.');
      let value;
      if (response.cancelled === true) value = { cancelled: true };
      else if (request.method === 'confirm' && typeof response.confirmed === 'boolean')
        value = { confirmed: response.confirmed };
      else if (
        ['select', 'input', 'editor'].includes(request.method) &&
        typeof response.value === 'string' &&
        response.value.trim() &&
        response.value.length <= 10000
      ) {
        if (request.method === 'select' && !request.allowCustom && !request.options?.includes(response.value))
          throw new Error('Choix invalide.');
        value = { value: response.value };
      } else throw new Error('Réponse invalide.');
      request.responding = true;
      let timer;
      try {
        await new Promise((resolve, reject) => {
          acknowledgements.set(id, { resolve, reject });
          timer = setTimeout(() => reject(new Error('Le moteur n’a pas confirmé la réponse.')), 10000);
          send({ type: 'extension_ui_response', id, ...value });
        });
        request.status = value.cancelled ? 'cancelled' : 'answered';
        request.answer = value.value ?? value.confirmed;
      } catch (error) {
        // Never let an uncertain reply be retried as a second answer.
        request.status = 'interrupted';
        throw error;
      } finally {
        clearTimeout(timer);
        acknowledgements.delete(id);
        request.responding = false;
        publish(request);
      }
      return { ...request };
    },
    close() {
      for (const pending of acknowledgements.values())
        pending.reject(new Error('La session a été interrompue.'));
      acknowledgements.clear();
      closeFor();
    },
  };
}
