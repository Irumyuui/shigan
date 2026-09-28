using System;

class Control
{
    int Loop(int[] xs, int limit)
    {
        int total = 0;
        foreach (var x in xs) {
            total += x;
        }

        while (total < limit) {
            total += 1;
        }

        do {
            total -= 1;
        } while (total > limit);

        switch (total) {
        case 1:
            return 10;
        default:
            break;
        }

    retry:
        for (int i = 0; i < limit; ++i) {
            while (total > 0) {
                if (total == 5) {
                    goto done;
                }
                total -= 2;
            }
        }
        goto retry;

    done:
        string kind = xs.Length switch
        {
            1 => "a",
            _ => "b",
        };
        return total > 0 ? total : -total;
    }
}
