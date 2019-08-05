/*
 * Copyright (c) 2019 NetEase Kubernetes Team
 * MIT Licensed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const debugEnabled = 'AVAIL_CPU_COUNT_DEBUG' in process.env ? true : false;

function getCgroupMouts() {
  var ces = {};
  var mounts;
  try {
    mounts = fs.readFileSync('/proc/self/mountinfo', {encoding: 'utf8'}).split('\n');
  } catch (e) {
    if (debugEnabled) {
      console.error('read /proc/self/mountinfo error: ', e);
    }
    return
  }

  for (var i = 0; i < mounts.length; ++i) {
    /* https://www.kernel.org/doc/Documentation/filesystems/proc.txt, section 3.5 */
    /* 2538 2528 0:33 /kubepods/burstable/pod6d65aafe-ad3c-11e9-a083-246e9645629c/925ee8269615bfb0c5e3a9697f61d5e589a6df088d712fa647d28464a83635ec /sys/fs/cgroup/memory ro,nosuid,nodev,noexec,relatime master:21 - cgroup cgroup rw,memory */
    var fl = mounts[i].split(' ');
    if (fl.length < 11) {
      continue;
    }

    var dash = fl.indexOf('-');
    if (dash === -1) {
      continue;
    }

    var fstype = fl[dash + 1];
    var option = fl[dash + 3];

    var root = fl[3];
    var mountPoint = fl[4];

    if (fstype !== 'cgroup') {
      continue;
    }

    var entry = {
      root: root,
      mountPoint: mountPoint
    };

    if (option.indexOf('memory') !== -1) {
      ces.memory = entry;
    } else if (option.indexOf('cpuset') !== -1) {
      /* We must check `cpuset` before check `cpu`, because `cpuset` includes `cpu`. 
       * Here we just check `cpuset`, and skip it */
      continue;
    } else if (option.indexOf('cpu,cpuacct') !== -1) {
      ces.cpu = entry;
      ces.cpuacct = entry;
    } else if (option.indexOf('cpuacct') !== -1) {
      ces.cpuacct = entry;
    } else if (option.indexOf('cpu') !== -1) {
      ces.cpu = entry;
    }
  }

  return ces;
}

var cgroupPath = {};
var cgroupPathInited = false;

function initCgroupPath() {
  if (cgroupPathInited) {
    return;
  }

  var ces = getCgroupMouts();
  if (ces === undefined) {
    return;
  }

  try {
    var cgroups = fs.readFileSync('/proc/self/cgroup', {encoding: 'utf8'}).split('\n');
  } catch (e) {
    if (debugEnabled) {
      console.error('read /proc/self/cgroup error: ', e);
    }
    return;
  }

  for (var i = 0; i < cgroups.length; ++i) {
    /* 10:memory:/kubepods/burstable/pod6d65aafe-ad3c-11e9-a083-246e9645629c/925ee8269615bfb0c5e3a9697f61d5e589a6df088d712fa647d28464a83635ec */
    var cl = cgroups[i].split(':');
    if (cl.length < 3) {
      continue;
    }
    var ctrl = cl[1];
    var dir = cl[2];

    if (ctrl.indexOf('memory') !== -1) {
      handleCgroupPath('memory', ces.memory, dir);
    } else if (ctrl.indexOf('cpuset') !== -1) {
      /* ditto */
      continue;
    } else if (ctrl.indexOf('cpu,cpuacct') !== -1) {
      handleCgroupPath('cpu', ces.cpu, dir);
      handleCgroupPath('cpuacct', ces.cpuacct, dir);
    } else if (ctrl.indexOf('cpuacct') !== -1) {
      handleCgroupPath('cpuacct', ces.cpuacct, dir);
    } else if (ctrl.indexOf('cpu') !== -1) {
      handleCgroupPath('cpu', ces.cpu, dir);
    }
  }
  cgroupPathInited = true;
}

function handleCgroupPath(key, ce, dir) {
  if (ce === undefined) {
    return;
  }

  if (ce.root === '/') {
    var path;
    if (dir !== '/') {
      cgroupPath[key] = ce.mountPoint + dir;
    } else {
      cgroupPath[key] = ce.mountPoint;
    }
  } else {
    if (ce.root === dir) {
      cgroupPath[key] = ce.mountPoint;
    } else {
      if (dir.indexOf(ce.root) !== 0) {
        return;
      }
      cgroupPath[key] = ce.mountPoint + dir.substring(ce.root.length);
    }
  }
}

function getCgroupIntValue(key, subpath) {
  initCgroupPath();

  if (cgroupPath[key] === undefined) {
    return -1;
  }

  var filename = path.join(cgroupPath[key], subpath);

  try {
    var content = fs.readFileSync(filename, {encoding: 'utf8'});
  } catch (e) {
    if (debugEnabled) {
      console.error('read file ' + filename + ' error: ', e);
    }
    return -1;
  }

  var v = parseInt(content);
  if (isNaN(v)) {
    return -1;
  }
  return v;
}

function availCpuCount() {
  var cpuCount = os.cpus().length;
  if (os.platform() !== 'linux') {
    return cpuCount;
  }

  var shareCount;
  var quotaCount;
  var cpuShares = getCgroupIntValue('cpu', 'cpu.shares');
  if (debugEnabled) {
      console.error('cpuShares is: ', cpuShares);
  }

  if (cpuShares !== -1) {
    shareCount = Math.ceil(cpuShares / 1024);
  } else {
    shareCount = cpuCount;
  }

  var quota = getCgroupIntValue('cpu', 'cpu.cfs_quota_us');
  var period = getCgroupIntValue('cpu', 'cpu.cfs_period_us');

  if (debugEnabled) {
      console.error('cpu quota & period: ', quota, period);
  }

  if (quota > -1 && period > 0) {
    quotaCount = Math.ceil(quota / period);
  } else {
    quotaCount = cpuCount;
  }

  /* skip use `shareCount` just now, maybe use shareCount later */
  if (quotaCount > cpuCount) {
    return cpuCount;
  }
  return quotaCount;
}

module.exports = availCpuCount;
