"""Discover with Prime Agent's actual kernel client, without creating an agent turn."""
import asyncio
import json
import sys

async def main():
    from rlm.mcp import _Generation
    request = json.loads(sys.stdin.read())
    generation = _Generation(request['name'], request['config'])
    try:
        await generation.open()
        tools = [tool for name, tool in generation.tools.items() if generation.allows(name)]
        print(json.dumps({'tools': tools[:500], 'total': len(tools)}))
    finally:
        await generation.close()

try:
    asyncio.run(main())
except Exception:
    # Provider diagnostics can contain private headers, URLs or environment values.
    print(json.dumps({'error': 'Connexion MCP impossible. Vérifiez la commande ou l’URL, les variables et l’authentification.'}))
    sys.exit(1)
