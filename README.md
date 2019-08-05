# Purpose

Retrieve available cpu count for nodejs running in docker.

On other platform/os, it is equivalent to `os.cpus().length()`.

# Example

```

const availCpuCount = require('availcpucount-js')();

console.log('avail cpu count: ', availCpuCount);

```

# Debug

```
set env AVAIL_CPU_COUNT_DEBUG to 'true'
```
