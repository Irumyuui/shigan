#include <stdio.h>

int scan(int x, int limit)
{
    int total = 0;
    int i = 0;
    while (i < limit) {
        total += i;
        ++i;
    }

    do {
        total -= 1;
    } while (total > 0);

    switch (x) {
    case 1:
        total += 10;
        break;
    default:
        total = 0;
        break;
    }

retry:
    for (i = 0; i < limit; ++i) {
        while (total < 100) {
            if (total == 42)
            {
                goto done;
            }
            total += x;
        }
    }
    goto retry;

done:
    return total > 0 ? total : -total;
}
