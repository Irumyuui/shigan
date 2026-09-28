#include <string>

#if defined(FEATURE_A)
int feature_a = 1;
#else
int feature_a = 0;
#endif

// A C++ raw string spans lines; brackets and quotes inside are not code.
const char *kRaw = R"delim(
    { ( "quoted" ) } [ ]
)delim";

// An ordinary string (escapes still apply) is skipped as usual.
const char *kNormal = "brace ): } and \"quote\"";

int main()
{
    return 0;
}
