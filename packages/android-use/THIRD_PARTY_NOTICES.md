# UIAutomator2 device-side service

The automation integration downloads `uiautomator2` 3.7.1 from its official PyPI distribution and uses its bundled `uiautomator2/assets/u2.jar`. Both the distribution and extracted artifact are pinned by SHA-256 in `src/automation/artifact.ts`. No Python runtime or client library is installed.

Sources:

- https://github.com/openatx/uiautomator2/tree/3.7.1
- https://github.com/openatx/android-uiautomator-server-jar

The selector mask constants and JSON-RPC interface follow the upstream client/server protocol.

## MIT license (device-side server)

Copyright (c) 2015 xiaocong@gmail.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
OR OTHER DEALINGS IN THE SOFTWARE.
