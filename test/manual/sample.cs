using System;

// Value-less #define is truthy in C#.
#define DEBUG

#if DEBUG
int level = 1;
#else
int level = 0;
#endif

// Verbatim strings keep backslashes and use "" for a quote.
string path = @"C:\temp\logs";
string quoted = @"she said ""hi""";

// Raw strings (C# 11) span lines and may contain quotes and braces.
string json = """
{
    "name": "shigan"
}
""";

int Main()
{
    return 0;
}
