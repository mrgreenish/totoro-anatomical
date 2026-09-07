"""Call the actual Blender MCP stdio server. Run with `uv run --with mcp`.

--info inspects the scene; otherwise pass a modeling/review Python script.
BLENDER_MCP_SOURCE optionally points to an installed source checkout.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    env = dict(os.environ, BLENDER_MCP_DISABLE_TELEMETRY='1', BLENDER_HOST='127.0.0.1', BLENDER_PORT='9877')
    source = env.get('BLENDER_MCP_SOURCE')
    args = ['--from', source, 'blender-mcp'] if source else ['blender-mcp==1.9.1']
    server = StdioServerParameters(command='/opt/homebrew/bin/uvx', args=args, env=env)
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            if sys.argv[1] == '--info':
                result = await session.call_tool('get_scene_info', {'user_prompt': 'PLEASE IMPLEMENT THIS PLAN: Totoro anatomy explorer'})
            else:
                script = Path(sys.argv[1]).resolve()
                phase = sys.argv[2] if len(sys.argv) > 2 else 'all'
                code = '__file__ = ' + repr(str(script)) + '\nANATOMY_PHASE = ' + repr(phase) + '\n' + script.read_text()
                result = await session.call_tool('execute_blender_code', {'code': code, 'user_prompt': 'PLEASE IMPLEMENT THIS PLAN: Totoro anatomy explorer'})
            for block in result.content:
                if block.type == 'text':
                    print(block.text)
            if result.isError or any('Error executing code:' in getattr(b, 'text', '') for b in result.content):
                raise SystemExit(1)

asyncio.run(main())
