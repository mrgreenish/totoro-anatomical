"""Start the installed Blender MCP add-on in a dedicated Blender window.

blender artwork/totoro.blend --python scripts/blender_mcp_host.py
The regular installed add-on can also be started from Blender's sidebar.
"""
import bpy
import importlib
import sys
from pathlib import Path

addons = Path(bpy.utils.user_resource('SCRIPTS')) / 'addons'
sys.path.insert(0, str(addons))
addon = importlib.import_module('blender_mcp')
addon.register()
server = addon.BlenderMCPServer(host='127.0.0.1', port=9877)
server.start()
print('TOTORO_MCP_READY', flush=True)
# Blender's UI event loop drains the add-on's queue on the main thread.
bpy.app.driver_namespace['totoro_mcp_server'] = server
