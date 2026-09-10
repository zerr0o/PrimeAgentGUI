import { Type } from 'typebox';

// Adapter of Prime Agent's question example: same tool/result concept, using
// its transportable select/input primitives instead of terminal-only ui.custom.
export default function studioQuestion(pi) {
  pi.registerTool({
    name: 'question',
    label: 'Question',
    description:
      'Ask the user a necessary clarification. Offer a few distinct options, each with a short description explaining its impact or tradeoff; a free-text answer is always possible. Wait for the result before continuing dependent work. Delegated agents should ask their parent instead.',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ minLength: 1, maxLength: 160 }),
          description: Type.String({ minLength: 1, maxLength: 500 }),
        }),
        { minItems: 2, maxItems: 6 },
      ),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const labels = params.options.map(
        (option, i) => `${i + 1}. ${option.label}${option.description ? ` — ${option.description}` : ''}`,
      );
      const other = 'Autre réponse / Other answer';
      const selected = await ctx.ui.select(params.question, [...labels, other], { signal });
      let answer,
        wasCustom = false;
      if (selected === other) {
        wasCustom = true;
        answer = await ctx.ui.input(params.question, 'Votre réponse / Your answer', { signal });
      } else {
        const index = labels.indexOf(selected);
        if (index >= 0) answer = params.options[index].label;
        else if (typeof selected === 'string') {
          answer = selected;
          wasCustom = true;
        }
      }
      const details = {
        question: params.question,
        options: params.options,
        answer: answer?.trim() || null,
        wasCustom,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(details) }],
        details,
      };
    },
  });
}
