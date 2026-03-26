<?php

if ($argc < 2) {
    fwrite(STDERR, "Usage: php scripts/seed_test_stats.php <sync_json_path>\n");
    exit(2);
}

$path = $argv[1];
if (!is_file($path)) {
    fwrite(STDERR, "File not found: {$path}\n");
    exit(1);
}

$raw = file_get_contents($path);
$json = json_decode($raw, true);
if (!is_array($json) || !isset($json['payload']['data'])) {
    fwrite(STDERR, "Invalid sync json\n");
    exit(1);
}

$data = &$json['payload']['data'];
$trainees = $data['trainees'] ?? [];
$groups = $data['groups'] ?? [];
$memberships = $data['memberships'] ?? [];
$settings = $data['settings'] ?? [];

$pricing = null;
foreach ($settings as $row) {
    if (($row['key'] ?? null) === 'pricing') {
        $pricing = $row;
        break;
    }
}
$tiers = $pricing['feeBySessionsPerWeek'] ?? [];

$traineeById = [];
foreach ($trainees as $trainee) {
    $traineeById[$trainee['id']] = $trainee;
}

$groupOrder = [];
foreach (array_values($groups) as $index => $group) {
    $groupOrder[$group['id']] = $index;
}

$membersByGroup = [];
$totalSessionsByTrainee = [];
foreach ($memberships as $membership) {
    $groupId = $membership['groupId'] ?? null;
    $traineeId = $membership['traineeId'] ?? null;
    if (!$groupId || !$traineeId) {
        continue;
    }
    $membersByGroup[$groupId][] = $membership;
    $totalSessionsByTrainee[$traineeId] = ($totalSessionsByTrainee[$traineeId] ?? 0) + (int)($membership['sessionsPerWeek'] ?? 0);
}

$distinctTraineeIds = array_values(array_unique(array_map(static fn($m) => $m['traineeId'] ?? '', $memberships)));
$distinctTraineeIds = array_values(array_filter($distinctTraineeIds));
$traineeIndex = [];
foreach ($distinctTraineeIds as $index => $traineeId) {
    $traineeIndex[$traineeId] = $index;
}

$computeAutoFee = static function (int $sessions, array $tiers): int {
    if (array_key_exists((string)$sessions, $tiers)) {
        return (int)$tiers[(string)$sessions];
    }
    $keys = array_values(array_filter(array_map('intval', array_keys($tiers)), static fn($k) => $k > 0));
    sort($keys);
    if (!$keys) {
        return isset($tiers['all']) ? (int)$tiers['all'] : 0;
    }
    $max = $keys[count($keys) - 1];
    if (isset($tiers['all']) && $sessions > $max) {
        return (int)$tiers['all'];
    }
    $best = $keys[0];
    foreach ($keys as $key) {
        if ($key <= $sessions) {
            $best = $key;
        }
    }
    return (int)($tiers[(string)$best] ?? 0);
};

$paymentRules = [
    '2026-01' => static fn(int $index): bool => $index % 4 !== 0,
    '2026-02' => static fn(int $index): bool => $index % 3 !== 0,
    '2026-03' => static fn(int $index): bool => $index % 2 === 0,
];

$payments = [];
foreach (array_keys($paymentRules) as $month) {
    foreach ($distinctTraineeIds as $traineeId) {
        $trainee = $traineeById[$traineeId] ?? [];
        $amount = ($trainee['pricingMode'] ?? 'auto') === 'manual'
            ? (int)($trainee['manualMonthlyFee'] ?? 0)
            : $computeAutoFee((int)($totalSessionsByTrainee[$traineeId] ?? 0), $tiers);

        $paid = $paymentRules[$month]($traineeIndex[$traineeId]);
        $payments[] = [
            'id' => guidv4(),
            'month' => $month,
            'traineeId' => $traineeId,
            'paid' => $paid,
            'amount' => $amount,
            'paidAt' => $paid ? to_ms("{$month}-20T12:00:00+00:00") : null,
            'createdAt' => to_ms("{$month}-01T09:00:00+00:00"),
        ];
    }
}

$attendance = [];
$start = new DateTimeImmutable('2026-01-01T12:00:00+00:00');
$end = new DateTimeImmutable('2026-03-26T12:00:00+00:00');
for ($day = $start; $day <= $end; $day = $day->modify('+1 day')) {
    $isoDay = (int)$day->format('N');
    $dateIso = $day->format('Y-m-d');
    foreach ($groups as $group) {
        $schedule = $group['schedule'] ?? [];
        $hasTraining = false;
        foreach ($schedule as $entry) {
            if ((int)($entry['dayOfWeek'] ?? 0) === $isoDay) {
                $hasTraining = true;
                break;
            }
        }
        if (!$hasTraining) {
            continue;
        }
        $members = $membersByGroup[$group['id']] ?? [];
        foreach ($members as $membership) {
            $traineeId = $membership['traineeId'];
            $seed = (int)$day->format('j') + (int)$day->format('n') + ($traineeIndex[$traineeId] ?? 0) + (($groupOrder[$group['id']] ?? 0) * 2);
            $present = $seed % 5 !== 0;
            if (!$present) {
                continue;
            }
            $attendance[] = [
                'id' => guidv4(),
                'dateISO' => $dateIso,
                'groupId' => $group['id'],
                'traineeId' => $traineeId,
                'present' => true,
                'updatedAt' => ((int)$day->format('U')) * 1000,
            ];
        }
    }
}

$data['attendance'] = $attendance;
$data['payments'] = $payments;
$json['updatedAt'] = time();
$json['payload']['exportedAt'] = gmdate('c');

file_put_contents($path, json_encode($json, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

echo "attendance=" . count($attendance) . PHP_EOL;
echo "payments=" . count($payments) . PHP_EOL;

function to_ms(string $value): int
{
    return strtotime($value) * 1000;
}

function guidv4(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}
