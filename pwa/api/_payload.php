<?php

function payload_list($value) {
  return is_array($value) && ($value === [] || array_keys($value) === range(0, count($value) - 1));
}
function payload_date($value) {
  if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) || substr($value, 0, 4) < '1900') return false;
  $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
  return $date !== false && $date->format('Y-m-d') === $value;
}
function payload_number($value, $integer = false, $minimum = 0) {
  return (is_int($value) || is_float($value)) && is_finite((float)$value) && $value <= 9007199254740991 && $value >= $minimum && (!$integer || floor($value) === (float)$value);
}
function payload_text($value) { return is_string($value) && trim($value) !== ''; }
function payload_schedule($schedule) {
  if (!payload_list($schedule)) return false;
  foreach ($schedule as $entry) {
    if (!is_array($entry) || !payload_number($entry['dayOfWeek'] ?? null, true, 1) || $entry['dayOfWeek'] > 7 ||
        !is_string($entry['startTime'] ?? null) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $entry['startTime']) ||
        !payload_number($entry['durationMin'] ?? null, true, 15)) return false;
  }
  return true;
}

function valid_sync_payload($payload) {
  if (!is_array($payload) || ($payload['version'] ?? null) !== 1 || !is_array($payload['data'] ?? null)) return false;
  $data = $payload['data'];
  $stores = ['trainees', 'groups', 'memberships', 'attendance', 'payments', 'settings', 'scopes', 'sessionScopes'];
  $ids = [];
  foreach ($stores as $store) {
    if (!isset($data[$store]) && in_array($store, ['scopes', 'sessionScopes'], true)) $data[$store] = [];
    if (!payload_list($data[$store] ?? null)) return false;
    $ids[$store] = [];
    foreach ($data[$store] as $row) {
      if (!is_array($row)) return false;
      $key = $row[$store === 'settings' ? 'key' : 'id'] ?? null;
      if (!payload_text($key) || isset($ids[$store][$key])) return false;
      $ids[$store][$key] = true;
      foreach (['createdAt', 'updatedAt', 'endedAt', 'paidAt'] as $field) {
        if (isset($row[$field]) && !payload_number($row[$field], true)) return false;
      }
    }
  }
  foreach ($data['trainees'] as $row) {
    if (!payload_text($row['firstName'] ?? null) || !payload_text($row['lastName'] ?? null) ||
        !in_array($row['pricingMode'] ?? 'auto', ['auto', 'manual'], true) ||
        (($row['pricingMode'] ?? 'auto') === 'manual' && !payload_number($row['manualMonthlyFee'] ?? null))) return false;
    foreach (['phone', 'email'] as $key) if (isset($row[$key]) && !is_string($row[$key])) return false;
  }
  foreach ($data['groups'] as $row) {
    if (!payload_text($row['name'] ?? null) || !payload_schedule($row['schedule'] ?? [])) return false;
    if (isset($row['cancelledDates'])) {
      if (!payload_list($row['cancelledDates'])) return false;
      foreach ($row['cancelledDates'] as $date) if (!payload_date($date)) return false;
    }
    if (isset($row['scheduleHistory'])) {
      if (!payload_list($row['scheduleHistory'])) return false;
      foreach ($row['scheduleHistory'] as $entry) if (!is_array($entry) || !payload_date($entry['fromISO'] ?? null) || !payload_schedule($entry['schedule'] ?? null)) return false;
    }
  }
  $unique = [];
  foreach ($data['memberships'] as $row) {
    $key = json_encode([$row['groupId'] ?? null, $row['traineeId'] ?? null]);
    if (!is_string($row['groupId'] ?? null) || !is_string($row['traineeId'] ?? null) ||
        !isset($ids['groups'][$row['groupId']]) || !isset($ids['trainees'][$row['traineeId']]) ||
        isset($unique[$key]) || !payload_number($row['sessionsPerWeek'] ?? null, true)) return false;
    $unique[$key] = true;
    if (isset($row['periods'])) {
      if (!payload_list($row['periods']) || !$row['periods']) return false;
      foreach ($row['periods'] as $period) {
        if (!is_array($period) || !payload_date($period['fromISO'] ?? null) || !array_key_exists('toISO', $period) ||
            ($period['toISO'] !== null && (!payload_date($period['toISO']) || $period['toISO'] < $period['fromISO']))) return false;
      }
    }
  }
  foreach (['attendance', 'payments', 'sessionScopes'] as $store) {
    $unique = [];
    foreach ($data[$store] as $row) {
      $key = json_encode($store === 'payments' ? [$row['month'] ?? null, $row['traineeId'] ?? null] :
        ($store === 'sessionScopes' ? [$row['dateISO'] ?? null, $row['groupId'] ?? null] :
          [$row['dateISO'] ?? null, $row['groupId'] ?? null, $row['traineeId'] ?? null]));
      if (isset($unique[$key])) return false;
      $unique[$key] = true;
      if ($store !== 'payments' && (!payload_date($row['dateISO'] ?? null) || !is_string($row['groupId'] ?? null) || !isset($ids['groups'][$row['groupId']]))) return false;
      if ($store !== 'sessionScopes' && (!is_string($row['traineeId'] ?? null) || !isset($ids['trainees'][$row['traineeId']]))) return false;
      if ($store === 'attendance' && !is_bool($row['present'] ?? null)) return false;
      if ($store === 'payments' && (!is_string($row['month'] ?? null) || !preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', $row['month']) ||
          !payload_number($row['amount'] ?? null) || !is_bool($row['paid'] ?? null))) return false;
      if ($store === 'sessionScopes') {
        if (!payload_list($row['scopeIds'] ?? null)) return false;
        foreach ($row['scopeIds'] as $id) if (!is_string($id) || !isset($ids['scopes'][$id])) return false;
      }
    }
  }
  $pricing = null;
  foreach ($data['settings'] as $row) if ($row['key'] === 'pricing') $pricing = $row;
  if ($pricing === null || !payload_text($pricing['currency'] ?? null) || !is_array($pricing['feeBySessionsPerWeek'] ?? null) || !$pricing['feeBySessionsPerWeek']) return false;
  foreach ($pricing['feeBySessionsPerWeek'] as $key => $value) {
    if (($key !== 'all' && !preg_match('/^(0|[1-9]\d*)$/D', (string)$key)) || !payload_number($value)) return false;
  }
  return true;
}
