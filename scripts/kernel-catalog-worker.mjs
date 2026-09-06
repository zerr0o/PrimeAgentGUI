import { nativeSkillResources } from './native-skill-resources.mjs';
process.once('message', async (options) => {
  try {
    const { loadedSkills, skills, missing, paths } = await nativeSkillResources(options);
    process.send({
      ok: true,
      skills: skills.getPythonSkillRuntimeInfo(
        loadedSkills.skills.filter((skill) => !skill.disableModelInvocation),
      ),
      diagnostics: [...missing, ...loadedSkills.diagnostics, ...(paths.diagnostics || [])].map(
        ({ message }) => message,
      ),
    });
  } catch (error) {
    process.send({ ok: false, error: error.message });
  }
});
