#include <vector>

int sum(const std::vector<int>& xs, int limit)
{
    int total = 0;
    for (auto x : xs) {
        total += x;
    }

    int i = 0;
    while (i < limit) {
        ++i;
    }

    switch (total) {
    case 1:
        total += 10;
        break;
    default:
        total = 0;
        break;
    }

retry:
    for (int j = 0; j < limit; ++j) {
        while (total > 0) {
            if (total == 7) {
                goto done;
            }
            total -= 1;
        }
    }
    goto retry;

done:
    auto clamp = [](int v) {
        return v < 0 ? 0 : v;
    };
    return total + clamp(limit);
}
